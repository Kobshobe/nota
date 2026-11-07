#!/usr/bin/env node
// 契约破坏性比对：当前 contract/openapi.yaml 对比上一个发布版本的快照。
// 只报告「会让已有客户端失效」的变更；纯新增不算破坏。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const currentPath = path.join(root, 'contract/openapi.yaml');
const baselinePath = path.join(root, 'contract/baseline/openapi.yaml');

const current = yaml.load(await readFile(currentPath, 'utf8'));
const baseline = yaml.load(await readFile(baselinePath, 'utf8'));

const problems = [];
const methods = ['get', 'post', 'put', 'patch', 'delete'];

for (const [route, basePathItem] of Object.entries(baseline.paths ?? {})) {
  const curPathItem = current.paths?.[route];
  if (!curPathItem) {
    problems.push(`删除路径 ${route}`);
    continue;
  }
  for (const method of methods) {
    const baseOp = basePathItem[method];
    if (!baseOp) continue;
    const curOp = curPathItem[method];
    if (!curOp) {
      problems.push(`删除操作 ${method.toUpperCase()} ${route}`);
      continue;
    }
    for (const status of Object.keys(baseOp.responses ?? {})) {
      if (!(status in (curOp.responses ?? {}))) {
        problems.push(`删除响应 ${method.toUpperCase()} ${route} → ${status}`);
      }
    }
    const baseBody = baseOp.requestBody?.required;
    const curBody = curOp.requestBody;
    if (baseBody && !curBody) problems.push(`${method.toUpperCase()} ${route} 移除了请求体`);
  }
}

for (const [name, baseSchema] of Object.entries(baseline.components?.schemas ?? {})) {
  const curSchema = current.components?.schemas?.[name];
  if (!curSchema) {
    problems.push(`删除 schema ${name}`);
    continue;
  }

  const baseProps = baseSchema.properties ?? {};
  const curProps = curSchema.properties ?? {};

  for (const [key, baseProp] of Object.entries(baseProps)) {
    const curProp = curProps[key];
    if (!curProp) {
      problems.push(`${name}.${key} 被删除`);
      continue;
    }
    if (baseProp.type && curProp.type && baseProp.type !== curProp.type) {
      problems.push(`${name}.${key} 类型 ${baseProp.type} → ${curProp.type}`);
    }
    if (baseProp.enum) {
      if (!curProp.enum) {
        problems.push(`${name}.${key} 移除了枚举约束`);
      } else {
        const removed = baseProp.enum.filter((value) => !curProp.enum.includes(value));
        if (removed.length > 0) {
          problems.push(`${name}.${key} 枚举移除 ${removed.join(', ')}`);
        }
      }
    }
    if (baseProp.maxLength && curProp.maxLength && curProp.maxLength < baseProp.maxLength) {
      problems.push(`${name}.${key} 长度上限收紧 ${baseProp.maxLength} → ${curProp.maxLength}`);
    }
  }

  const baseRequired = new Set(baseSchema.required ?? []);
  for (const key of curSchema.required ?? []) {
    if (!baseRequired.has(key)) problems.push(`${name}.${key} 新增为必填`);
  }

  if (baseSchema.additionalProperties !== false && curSchema.additionalProperties === false) {
    problems.push(`${name} 开始禁止额外字段`);
  }
}

const added = Object.keys(current.paths ?? {}).filter((route) => !(route in (baseline.paths ?? {})));
const addedCodes = (current.components?.schemas?.ErrorResponse?.properties?.code?.enum ?? [])
  .filter((code) => !(baseline.components?.schemas?.ErrorResponse?.properties?.code?.enum ?? []).includes(code));

console.log(`契约版本：${baseline.info?.version ?? '?'} → ${current.info?.version ?? '?'}`);
if (added.length > 0) console.log(`新增路径（非破坏）：${added.join(', ')}`);
if (addedCodes.length > 0) console.log(`新增错误码（非破坏）：${addedCodes.join(', ')}`);

if (problems.length > 0) {
  console.log('\n发现破坏性变更：');
  for (const problem of problems) console.log(`  - ${problem}`);
  console.log('\n已有客户端会因此失效。改用新增字段/新增端点，或提升主版本并同步更新两端。');
  process.exitCode = 1;
} else {
  console.log('\n没有破坏性变更。');
}
