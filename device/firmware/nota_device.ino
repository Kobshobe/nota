// Nota 设备模拟器：Wokwi ESP32 DevKitC V4 + Arduino。
// 真机上这里是 I2S 麦克风与喇叭；模拟器没有这两样，所以输入用内嵌 MP3，
// 输出只把 TTS 文本和音频字节数打到串口。协议、鉴权、轮询与真机一致。
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
const unsigned long MAX_HOLD_MS = 60000UL;
const unsigned long FIXTURE_DURATION_MS = 2592UL;
const char* BOUNDARY = "----notaDeviceBoundary";

String baseUrl;
String deviceToken;
WiFiClientSecure tls;

void ledOff() { digitalWrite(LED_PIN, LOW); }

void failBlink() {
  for (int i = 0; i < 3; i += 1) {
    digitalWrite(LED_PIN, HIGH);
    delay(150);
    digitalWrite(LED_PIN, LOW);
    delay(150);
  }
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

bool httpPost(const String& url, const std::vector<uint8_t>& body, String& response, int& code) {
  HTTPClient http;
  http.setTimeout(20000);
  if (!http.begin(tls, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + deviceToken);
  http.addHeader("Content-Type", String("multipart/form-data; boundary=") + BOUNDARY);
  code = http.POST(body.data(), body.size());
  response = http.getString();
  http.end();
  return code > 0;
}

bool httpGet(const String& url, String& response, int& code) {
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(tls, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + deviceToken);
  code = http.GET();
  response = http.getString();
  http.end();
  return code > 0;
}

bool downloadReplyAudio(const String& url, size_t& bytes) {
  HTTPClient http;
  http.setTimeout(20000);
  if (!http.begin(tls, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + deviceToken);
  int code = http.GET();
  if (code != 200) {
    http.end();
    return false;
  }
  int expected = http.getSize();
  WiFiClient* stream = http.getStreamPtr();
  bytes = 0;
  const unsigned long deadline = millis() + 10000UL;
  while (millis() < deadline) {
    int available = stream->available();
    if (available > 0) {
      while (available-- > 0) {
        stream->read();
        bytes += 1;
      }
      if (expected >= 0 && bytes >= (size_t)expected) break;
      continue;
    }
    if (expected >= 0 && bytes >= (size_t)expected) break;
    if (!http.connected()) break;
    delay(10);
  }
  http.end();
  return expected < 0 ? bytes > 0 : bytes >= (size_t)expected;
}

bool sendUtterance() {
  std::vector<uint8_t> audio((FIXTURE_BASE64_LENGTH / 4) * 3);
  size_t audioLength =
      base64Decode(FIXTURE_BASE64, FIXTURE_BASE64_LENGTH, audio.data(), audio.size());
  audio.resize(audioLength);
  if (audioLength == 0) {
    Serial.println("fixture: decode failed");
    return false;
  }

  std::vector<uint8_t> body;
  auto appendText = [&body](const char* text) {
    body.insert(body.end(), reinterpret_cast<const uint8_t*>(text),
                reinterpret_cast<const uint8_t*>(text) + strlen(text));
  };
  appendText("--");
  appendText(BOUNDARY);
  appendText("\r\nContent-Disposition: form-data; name=\"durationMs\"\r\n\r\n");
  appendText(String(FIXTURE_DURATION_MS).c_str());
  appendText("\r\n--");
  appendText(BOUNDARY);
  appendText("\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"utterance.mp3\"\r\n");
  appendText("Content-Type: audio/mpeg\r\n\r\n");
  body.insert(body.end(), audio.begin(), audio.end());
  appendText("\r\n--");
  appendText(BOUNDARY);
  appendText("--\r\n");

  String response;
  int code = 0;
  if (!httpPost(baseUrl + "/api/device/utterances", body, response, code)) {
    Serial.println("upload: request failed");
    return false;
  }
  Serial.print("upload: HTTP ");
  Serial.println(code);
  if (code != 202) {
    Serial.println(response);
    return false;
  }
  String id = jsonStringField(response, "id");
  if (id.length() == 0) {
    Serial.println("upload: response has no id");
    return false;
  }
  Serial.print("upload: id=");
  Serial.println(id);

  String statusUrl = baseUrl + "/api/device/utterances/" + id;
  const unsigned long pollDeadline = millis() + 120000UL;
  for (int attempt = 0; attempt < 120 && millis() < pollDeadline; attempt += 1) {
    delay(1000);
    String payload;
    int statusCode = 0;
    if (!httpGet(statusUrl, payload, statusCode) || statusCode != 200) {
      Serial.print("poll: HTTP ");
      Serial.println(statusCode);
      if (statusCode == 401 || statusCode == 404) {
        Serial.println("poll: device token or utterance not found");
        return false;
      }
      continue;
    }
    String status = jsonStringField(payload, "status");
    if (status == "completed") {
      String replyText = jsonStringField(payload, "replyText");
      String replyAudioUrl = jsonStringField(payload, "replyAudioUrl");
      Serial.print("reply: ");
      Serial.println(replyText);
      if (replyAudioUrl.length() > 0) {
        size_t audioBytes = 0;
        if (downloadReplyAudio(baseUrl + replyAudioUrl, audioBytes)) {
          Serial.print("would play ");
          Serial.print(audioBytes);
          Serial.println(" bytes");
        } else {
          Serial.println("reply audio: download failed");
        }
      } else {
        Serial.println("reply audio: unavailable");
      }
      return true;
    }
    if (status == "failed") {
      Serial.print("failed: ");
      Serial.println(jsonStringField(payload, "errorCode"));
      return false;
    }
    Serial.println("poll: processing");
  }
  Serial.println("poll: timed out");
  return false;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  ledOff();
  delay(300);

  Serial.println();
  Serial.println("Nota device simulator");
  Serial.println("paste: <baseUrl> <deviceToken>");
  readConfig();

  while (!connectWifi()) {
    failBlink();
    delay(2000);
  }
  tls.setInsecure();
  Serial.println("ready: hold GPIO4 to talk");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED && !connectWifi()) {
    failBlink();
    delay(2000);
    return;
  }
  if (digitalRead(BUTTON_PIN) == HIGH) {
    delay(20);
    return;
  }

  digitalWrite(LED_PIN, HIGH);
  Serial.println("recording: release the button to send");
  unsigned long startedAt = millis();
  while (digitalRead(BUTTON_PIN) == LOW && millis() - startedAt < MAX_HOLD_MS) {
    delay(10);
  }

  Serial.println("sending...");
  bool ok = sendUtterance();
  ledOff();
  if (!ok) failBlink();
  delay(400);
}
