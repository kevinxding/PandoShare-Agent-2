# Release Checklist

- Run npm run typecheck
- Run npm run check
- Run npm run acceptance:full
- Run npm run security:report-smoke
- Run npm run release:smoke
- Confirm LICENSE owner decision
- Confirm package private flag decision
- Confirm no real GUI/model/gateway online dependency is required for offline release validation
