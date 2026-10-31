---
name: Mongoose Node ESM interop
description: Mongoose is CommonJS and Node's built-in TypeScript stripping does not reliably expose named exports.
---

Use `import mongoose from "mongoose"` and destructure its APIs when a Mongoose module is consumed directly by Node's native TypeScript strip loader. A named import such as `import { models } from "mongoose"` can pass TypeScript and bundle checks but fail at runtime because Node does not detect that CommonJS named export.

**Why:** Node v24's native TypeScript loader rejected Mongoose named exports in a direct integration test even though the production esbuild bundle and TypeScript check succeeded.

**How to apply:** For test scripts that import TypeScript source directly with `--experimental-strip-types`, prefer Mongoose's default import form; retain normal TypeScript and bundle checks as separate validation.
