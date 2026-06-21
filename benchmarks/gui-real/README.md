# Dingxu GUI Real Benchmark Baseline

This pack is mock-first. It exercises PandoShare GUI runtime behavior without moving the real desktop pointer by default.

Supported benchmark types:

- observe_health
- click_target
- type_text
- hotkey
- focus_switch
- visual_compare
- stuck_recovery
- approval_required
- release_input

The `dingxu-health` scenario is a health probe only. It is skipped with `skipped_real_gui` unless `PANDO_GUI_REAL=1` is present. Even in real mode, the baseline only connects and diagnoses the Dingxu backend; it does not click, type, or send desktop input.

Reports are written as JSON and Markdown. Screenshot evidence is recorded as refs such as `mock://...` or backend paths, never as base64 event payloads.
