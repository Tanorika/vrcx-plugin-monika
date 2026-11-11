# VRCX 最小源码快照

来源：[vrcx-team/VRCX](https://github.com/vrcx-team/VRCX)，版本 `2026.09.16`，提交 `267cb69138f0adc5127872fcce64bb0c785f7b9f`，MIT 许可证见 [LICENSE](LICENSE)。

`src/` 保留 Monika 构建需要的原始组件、数据库、事件逻辑、公共工具，以及独立预览需要的宿主全局样式。逐文件原始 SHA-256 记录在 [SOURCE.json](SOURCE.json)。`npm run check` 验证快照未被意外修改。

构建适配由 `scripts/native-source-adaptations.mjs` 完成，不能直接修改快照文件来修复 Monika。升级来源时应明确新的上游提交、更新依赖清单与哈希，并验证编译与账号隔离。

`dist/native-ui-inputs.json` 和 `dist/vendor-context-inputs.json` 是构建生成的使用路径清单，供维护者核对快照范围。完整 VRCX checkout 不属于本仓库，也不是构建前提。
