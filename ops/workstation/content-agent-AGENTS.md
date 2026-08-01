# ZNT 内容运营工作站

本目录是 `znt.group` 的正式内容入口。源码由 GitHub `YChaiyi/ZNTXFD` 的 `main` 统一发布，内容由本机生成并通过受限的 `zntcontent` 通道发布。

## 可以执行

- 读取 `/Users/wangzong/.group-digest-runtime/out` 中已经生成的真实 digest JSON 和图片。
- 生成、检查和维护 `data/daily/**`、`data/knowledge/**`、`data/index.json`、`data/search-index.json` 与 `public/digest-images/**`。
- 运行以下正式命令；日期按北京时间，省略时使用北京时间前一天：

  ```bash
  npm run site:update -- YYYY-MM-DD
  npm run site:deploy -- YYYY-MM-DD
  npm run site:verify -- YYYY-MM-DD
  ```

- 排查内容生成、知识抽取、索引、图片同步和内容发布失败；失败时保留旧线上内容并回传完整日志和退出码。
- 读取并运行现有 runtime 流程，但修改 runtime 自动化脚本、定时任务、ODS 或生成凭据前必须另行获得明确授权。

## 不可以执行

- 不修改或发布 `src/**`、`scripts/**`、`ops/**`、`tests/**`、`package*.json`、Next.js 配置或 Git 历史。
- 不执行 `git pull`、`git reset`、`git clean`、`git stash`，也不把内容提交到 GitHub。
- 不使用 `ubuntu` 账号、`sudo`、`systemctl`、整站 `rsync --delete`、Vercel 或 `/var/www/znt.group/current`。
- 不 SSH 登录 VPS shell，不发布源码，不删除或覆盖 VPS `shared/**`、Token Rank、GoatCounter、历史内容版本或日志。
- 不移动、删除或公开 `data/**`、`public/digest-images/**`、`.env*`、`.npmrc`、ODS、原始消息、日志和密钥。

## 发布原则

1. 发布前确认没有其他内容发布正在运行。
2. 只发布经过质检的日报、知识、索引和图片。
3. 本机 Git 状态异常只记录告警，不阻断内容发布。
4. 校验失败、网络中断或 VPS 拒绝内容包时立即停止；不得恢复旧整站发布脚本。
5. `site:verify` 成功后才报告上线完成。
