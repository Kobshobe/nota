# 改这里：你的两端目录与测试命令。只有一端就把另一端的变量改成同一个目录。
SERVER_DIR ?= server
CLIENT_DIR ?= app
SERVER_TEST = cd $(SERVER_DIR) && npx tsc --noEmit && npm test
CLIENT_TEST = cd $(CLIENT_DIR) && flutter analyze && flutter test

PORT ?= 8080

export PUB_CACHE := $(CURDIR)/.cache/pub
export FLUTTER_SUPPRESS_ANALYTICS := true

.PHONY: deps check check-all check-server check-app docs breaking contract test e2e baseline

## 首次使用：只装门禁脚本自己用的依赖
deps:
	npm install

## 骨架阶段 / 只有一端时
check: docs breaking

check-server: docs breaking
	@test -d $(SERVER_DIR) || { echo "$(SERVER_DIR)/ 不存在：先实现服务端，或改 Makefile 的 SERVER_DIR"; exit 1; }
	$(SERVER_TEST)
	node scripts/check-contract.mjs

check-app: docs breaking
	@test -d $(CLIENT_DIR) || { echo "$(CLIENT_DIR)/ 不存在：先实现客户端，或改 Makefile 的 CLIENT_DIR"; exit 1; }
	$(CLIENT_TEST)

## 完成标准：两端都在
check-all: docs breaking test contract

docs:
	python3 .agents/scripts/check_docs.py

breaking:
	node scripts/check-breaking.mjs

contract:
	node scripts/check-contract.mjs

test:
	@test -d $(SERVER_DIR) || { echo "$(SERVER_DIR)/ 不存在：先实现服务端，或改 Makefile 的 SERVER_DIR"; exit 1; }
	@test -d $(CLIENT_DIR) || { echo "$(CLIENT_DIR)/ 不存在：先实现客户端，或改 Makefile 的 CLIENT_DIR"; exit 1; }
	$(SERVER_TEST)
	$(CLIENT_TEST)

e2e:
	PORT=$(PORT) bash scripts/e2e.sh

## 发布时把当前契约冻结为新的比对基线
baseline:
	cp contract/openapi.yaml contract/baseline/openapi.yaml
	@echo "baseline 已更新，提交它。"
