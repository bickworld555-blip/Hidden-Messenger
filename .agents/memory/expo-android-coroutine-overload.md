---
name: Expo Android coroutine overload
description: Disambiguate zero-argument async functions in Expo native modules.
---

When an Expo Android `AsyncFunction` uses the `Coroutine` DSL with no JavaScript parameters, Kotlin may consider both zero-argument and one-argument overloads. Specify the result type, such as `.Coroutine<Unit> { ... }`, to select the intended zero-argument suspend handler.

**Why:** Android CI reported overload-resolution ambiguity after the `Coroutine` extension was imported. Explicitly typing `Unit` resolved it, and the APK build then passed.

**How to apply:** In Expo Kotlin modules, use an explicit result type for zero-argument coroutine handlers; parameterized handlers can continue to infer their arity.
