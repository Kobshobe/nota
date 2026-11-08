// Nota 会议录音设备模拟器：Wokwi ESP32 DevKitC V4 + Arduino。
// 真机用 I2S 麦克风录音、microSD 存整场会议；模拟器没有麦克风，
// 输入是内嵌的一段会议音频，按钮、LED、上传和轮询与真机同一条状态机。
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <cstring>
#include <vector>
#include "fixture.h"

namespace {

const char* WIFI_SSID = "Wokwi-GUEST";
const int WIFI_CHANNEL = 6;
const int BUTTON_PIN = 4;
const int LED_PIN = 5;
const unsigned long MAX_RECORDING_MS = 480000UL;
const unsigned long FIXTURE_DURATION_MS = 22467UL;
const unsigned long POLL_INTERVAL_MS = 5000UL;
const unsigned long POLL_TIMEOUT_MS = 300000UL;
const unsigned long FAIL_BLINK_MS = 10000UL;
const unsigned long LONG_PRESS_MS = 2000UL;
const char* BOUNDARY = "----notaDeviceBoundary";

enum DeviceState { IDLE, RECORDING, UPLOADING };

String baseUrl;
String deviceToken;
WiFiClientSecure tls;
DeviceState state = IDLE;
bool hasPending = false;
String pendingId;
unsigned long recordingStartedAt = 0;
bool buttonWasDown = false;
bool pressConsumed = false;
unsigned long buttonDownAt = 0;
bool longPressHandled = false;

void ledOn() { digitalWrite(LED_PIN, HIGH); }
void ledOff() { digitalWrite(LED_PIN, LOW); }

// 上传时不阻塞灯：HTTPClient 每读一块 body，就翻转一次 LED，让「上传中」看得见。
class BlinkStream : public Stream {
 public:
  BlinkStream(const uint8_t* data, size_t length) : data_(data), length_(length) {}

  int available() override { return (int)(length_ - position_); }

  int read() override {
    if (position_ >= length_) return -1;
    const unsigned long now = millis();
    if (now - lastToggle_ >= 500UL) {
      lastToggle_ = now;
      ledState_ = !ledState_;
      digitalWrite(LED_PIN, ledState_ ? HIGH : LOW);
    }
    return data_[position_++];
  }

  int peek() override { return position_ < length_ ? data_[position_] : -1; }
  void flush() override {}
  size_t write(uint8_t) override { return 0; }

 private:
  const uint8_t* data_;
  size_t length_;
  size_t position_ = 0;
  bool ledState_ = false;
  unsigned long lastToggle_ = 0;
};

void slowBlinkTick() {
  digitalWrite(LED_PIN, (millis() % 1000UL) < 500UL ? HIGH : LOW);
}

void failBlink() {
  const unsigned long deadline = millis() + FAIL_BLINK_MS;
  while (millis() < deadline) {
    digitalWrite(LED_PIN, (millis() % 200UL) < 100UL ? HIGH : LOW);
    delay(10);
  }
  ledOff();
}

int base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

size_t base64Decode(const char* input, size_t length, uint8_t* out, size_t capacity) {
  size_t outLength = 0;
  int buffer = 0;
  int bits = 0;
  for (size_t i = 0; i < length; i += 1) {
    char c = input[i];
    if (c == '=') break;
    int value = base64Value(c);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (outLength < capacity) out[outLength++] = (uint8_t)((buffer >> bits) & 0xFF);
    }
  }
  return outLength;
}

// 服务端只返回很小的扁平 JSON；不值得为此引入 JSON 库。
String jsonStringField(const String& json, const char* key) {
  String needle = String("\"") + key + "\":\"";
  int start = json.indexOf(needle);
  if (start < 0) return String();
  int index = start + needle.length();
  String value;
  while (index < (int)json.length()) {
    char c = json[index++];
    if (c == '"') break;
    if (c == '\\' && index < (int)json.length()) {
      char escaped = json[index++];
      if (escaped == 'n') value += '\n';
      else if (escaped == 't') value += '\t';
      else if (escaped == 'u' && index + 4 <= (int)json.length()) index += 4;
      else value += escaped;
    } else {
      value += c;
    }
  }
  return value;
}

bool connectWifi() {
  Serial.print("wifi: connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, "", WIFI_CHANNEL);
  for (int attempt = 0; attempt < 60; attempt += 1) {
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("wifi: connected, ip=");
      Serial.println(WiFi.localIP());
      return true;
    }
    Serial.print(".");
    delay(500);
  }
  Serial.println();
  Serial.println("wifi: failed");
  return false;
}

bool readConfig() {
  String line;
  while (true) {
    while (Serial.available()) {
      char c = (char)Serial.read();
      if (c != '\n' && c != '\r') {
        line += c;
        continue;
      }
      line.trim();
      if (line.length() == 0) continue;
      int space = line.indexOf(' ');
      if (space < 0) space = line.indexOf('\t');
      if (space > 0) {
        String url = line.substring(0, space);
        String token = line.substring(space + 1);
        url.trim();
        token.trim();
        while (url.endsWith("/")) url.remove(url.length() - 1);
        if (url.startsWith("http") && token.length() > 0) {
          baseUrl = url;
          deviceToken = token;
          Serial.print("config: baseUrl=");
          Serial.println(baseUrl);
          return true;
        }
      }
      Serial.println("expected: <baseUrl> <deviceToken>");
      line = "";
    }
    delay(20);
  }
}

bool httpPost(const String& url, std::vector<uint8_t>& body, String& response, int& code) {
  HTTPClient http;
  http.setTimeout(60000);
  http.setConnectTimeout(30000);
  if (!http.begin(tls, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + deviceToken);
  http.addHeader("Content-Type", String("multipart/form-data; boundary=") + BOUNDARY);
  BlinkStream stream(body.data(), body.size());
  code = http.sendRequest("POST", &stream, body.size());
  if (code <= 0) {
    Serial.print("upload: error ");
    Serial.print(code);
    Serial.print(" ");
    Serial.println(HTTPClient::errorToString(code));
  }
  response = http.getString();
  http.end();
  return code > 0;
}

bool httpGet(const String& url, String& response, int& code) {
  HTTPClient http;
  http.setTimeout(15000);
  http.setConnectTimeout(30000);
  if (!http.begin(tls, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + deviceToken);
  code = http.GET();
  response = http.getString();
  http.end();
  return code > 0;
}

bool pollRecording() {
  String url = baseUrl + "/api/device/recordings/" + pendingId;
  const unsigned long deadline = millis() + POLL_TIMEOUT_MS;
  while (millis() < deadline) {
    const unsigned long waitUntil = millis() + POLL_INTERVAL_MS;
    while (millis() < waitUntil) {
      slowBlinkTick();
      delay(100);
    }
    String payload;
    int code = 0;
    if (!httpGet(url, payload, code) || code != 200) {
      Serial.print("poll: HTTP ");
      Serial.println(code);
      if (code == 401 || code == 404) {
        Serial.println("poll: device token or recording not found");
        pendingId = "";
        return false;
      }
      continue;
    }
    String status = jsonStringField(payload, "status");
    if (status == "completed") {
      Serial.print("completed: thread=");
      Serial.println(jsonStringField(payload, "threadId"));
      return true;
    }
    if (status == "failed") {
      Serial.print("failed: ");
      Serial.println(jsonStringField(payload, "errorCode"));
      // 服务端已经给了终态：下次重试重新上传，而不是继续查这一条。
      pendingId = "";
      return false;
    }
    Serial.println("poll: transcribing");
  }
  Serial.println("poll: timed out");
  // 超时只说明还没拿到终态；保留 id，重试时继续查同一场，避免重复建会。
  return false;
}

bool uploadRecording() {
  pendingId = "";
  String head = String("--") + BOUNDARY +
                "\r\nContent-Disposition: form-data; name=\"durationMs\"\r\n\r\n" +
                String(FIXTURE_DURATION_MS) + "\r\n--" + BOUNDARY +
                "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"meeting.mp3\"\r\n"
                "Content-Type: audio/mpeg\r\n\r\n";
  String tail = String("\r\n--") + BOUNDARY + "--\r\n";
  const size_t capacity = (FIXTURE_BASE64_LENGTH / 4) * 3;
  std::vector<uint8_t> body(head.length() + capacity + tail.length());
  memcpy(body.data(), head.c_str(), head.length());
  const size_t audioLength =
      base64Decode(FIXTURE_BASE64, FIXTURE_BASE64_LENGTH, body.data() + head.length(), capacity);
  if (audioLength == 0) {
    Serial.println("fixture: decode failed");
    return false;
  }
  memcpy(body.data() + head.length() + audioLength, tail.c_str(), tail.length());
  body.resize(head.length() + audioLength + tail.length());

  Serial.println("upload: sending");
  String response;
  int code = 0;
  bool posted = false;
  for (int attempt = 0; attempt < 3 && !posted; attempt += 1) {
    if (attempt > 0) {
      Serial.print("upload: retry ");
      Serial.println(attempt);
      delay(2000);
    }
    posted = httpPost(baseUrl + "/api/device/recordings", body, response, code);
    if (!posted && code != 0 && code != HTTPC_ERROR_CONNECTION_REFUSED &&
        code != HTTPC_ERROR_NOT_CONNECTED) {
      // 请求可能已经到达服务端，只是没拿到响应；重发可能建第二场会。
      break;
    }
  }
  if (!posted) {
    Serial.println("upload: request failed");
    return false;
  }
  Serial.print("upload: HTTP ");
  Serial.println(code);
  if (code != 202) {
    Serial.println(response);
    return false;
  }
  pendingId = jsonStringField(response, "id");
  if (pendingId.length() == 0) {
    Serial.println("upload: response has no id");
    return false;
  }
  Serial.print("upload: id=");
  Serial.println(pendingId);
  return true;
}

bool sendRecording() {
  // body 在 uploadRecording 返回后释放，轮询时不再占着 90 KB 的音频缓冲。
  if (!uploadRecording()) return false;
  return pollRecording();
}

void finishAttempt(bool ok) {
  if (ok) {
    hasPending = false;
    pendingId = "";
    state = IDLE;
    ledOff();
    Serial.println("state: idle");
    return;
  }
  failBlink();
  state = IDLE;
  ledOff();
  Serial.println(hasPending ? "state: idle (pending)" : "state: idle");
}

void startRecording() {
  state = RECORDING;
  recordingStartedAt = millis();
  ledOn();
  Serial.println("recording: started");
}

void stopAndUpload() {
  state = UPLOADING;
  hasPending = true;
  digitalWrite(LED_PIN, HIGH);
  Serial.println("recording: stopped");
  finishAttempt(sendRecording());
}

void retryPending() {
  if (!hasPending) return;
  state = UPLOADING;
  digitalWrite(LED_PIN, HIGH);
  if (pendingId.length() > 0) {
    Serial.println("retry: polling same recording");
    finishAttempt(pollRecording());
  } else {
    Serial.println("retry: uploading again");
    finishAttempt(sendRecording());
  }
}

void discardPending() {
  hasPending = false;
  pendingId = "";
  state = IDLE;
  ledOff();
  Serial.println("discard: pending recording dropped");
}

void triggerShortPress() {
  if (state == RECORDING) {
    stopAndUpload();
  } else if (state == IDLE) {
    if (hasPending) retryPending();
    else startRecording();
  }
}

void probeConnection() {
  String host = baseUrl;
  host.replace("https://", "");
  host.replace("http://", "");
  int slash = host.indexOf('/');
  if (slash >= 0) host = host.substring(0, slash);
  IPAddress address;
  int resolved = WiFi.hostByName(host.c_str(), address);
  Serial.print("probe: dns=");
  Serial.print(resolved);
  Serial.print(" ip=");
  Serial.println(address);
  String response;
  int code = 0;
  const bool ok = httpGet(baseUrl + "/api/health", response, code);
  Serial.print("probe: health=");
  Serial.print(ok ? 1 : 0);
  Serial.print(" code=");
  Serial.println(code);
  Serial.println(response);
}

void handleSerial() {
  while (Serial.available()) {
    char command = (char)Serial.read();
    if (command == 's' || command == 'S') {
      Serial.println("serial: short press");
      triggerShortPress();
    } else if (command == 'd' || command == 'D') {
      if (state == IDLE && hasPending) discardPending();
    } else if (command == 't' || command == 'T') {
      probeConnection();
    }
  }
}

void handleButton() {
  const bool down = digitalRead(BUTTON_PIN) == LOW;
  if (down && !buttonWasDown) {
    buttonDownAt = millis();
    longPressHandled = false;
    pressConsumed = false;
    if (state == RECORDING) {
      pressConsumed = true;
      stopAndUpload();
    } else if (state == IDLE && !hasPending) {
      pressConsumed = true;
      startRecording();
    }
  }
  if (down && buttonWasDown && !pressConsumed && state == IDLE && hasPending && !longPressHandled &&
      millis() - buttonDownAt >= LONG_PRESS_MS) {
    longPressHandled = true;
    pressConsumed = true;
    discardPending();
  }
  if (!down && buttonWasDown) {
    if (!pressConsumed && state == IDLE && hasPending && !longPressHandled &&
        millis() - buttonDownAt > 50) {
      retryPending();
    }
    pressConsumed = false;
  }
  buttonWasDown = down;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  ledOff();
  delay(300);

  Serial.println();
  Serial.println("Nota meeting recorder simulator");
  Serial.println("paste: <baseUrl> <deviceToken>");
  readConfig();

  while (!connectWifi()) {
    failBlink();
    delay(2000);
  }
  tls.setInsecure();
  Serial.println("ready: press GPIO4 to record");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED && !connectWifi()) {
    failBlink();
    delay(2000);
    return;
  }
  handleSerial();
  handleButton();
  if (state == RECORDING && millis() - recordingStartedAt >= MAX_RECORDING_MS) {
    Serial.println("recording: limit reached");
    stopAndUpload();
  }
  delay(10);
}
