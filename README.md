# 智能体先锋队知识库

社群知识日报、可信知识库与 Token 消耗排行榜。生产入口为 [znt.group](https://znt.group)。

## 边界约定

- GitHub 只保存源码、测试、运维模板和工作流。
- `data/**`、`public/digest-images/**`、ODS、原始消息、环境文件、日志和密钥不进入 GitHub。
- VPS 是唯一生产入口；生产内容、Token Rank 状态、GoatCounter 数据和日志都保存在 `shared/`。
- 代码只在 `main` 合并后由 GitHub Actions 发布；日报负责人本机只发布内容包，不上传源码。
- 网站内容使用固定密码访问；GoatCounter `/stats/` 保持公开。

代码与内容在 VPS 上独立保存并成对记录：

```text
/var/www/znt.group/
  current -> releases/<git-sha>
  releases/<git-sha>/
  shared/
    content/current -> releases/<content-version>
    content/releases/<content-version>/
    state/token-rank/token-rank-store.json
    goatcounter/
    runtime/app.env
    deploy-state.json
```

代码发布失败时恢复上一组代码与内容版本。内容切换失败不会修改当前线上指针；较新的内容版本只停用，不删除。

## 日报操作

日报负责人继续在固定的正式项目目录执行以下命令；真实绝对路径只保存在工作站本地：

```bash
cd "$ZNT_SITE_DIR"

npm run site:update -- YYYY-MM-DD
npm run site:deploy -- YYYY-MM-DD
npm run site:verify -- YYYY-MM-DD
```

- 数据源：`$GROUP_DIGEST_RUNTIME/out`
- 日期按北京时间；省略日期时使用北京时间前一天。
- `site:update` 在本机生成并质检日报、知识、索引和图片。
- `site:deploy` 先执行同一生成流程，再只上传内容包；本机 Git 状态异常只告警。
- `site:verify` 自动登录并核对线上日期、标题和内容版本。

内容包只包含：

```text
daily/
knowledge/
index.json
search-index.json
digest-images/
manifest.json
```

`data/.work`、ODS、原始消息、环境文件、日志、密钥和源码不会进入内容包。

## 代码发布

开发通过个人 fork 提交 PR。CI 校验依赖安装、TypeScript、lint、测试、source-only 构建和敏感文件；合并 `main` 后，Actions 将精确 Git SHA 交给 VPS 的受限部署账户。

VPS 在候选 release 中执行 `npm ci`、构建、内容兼容性检查、原子切换、服务重启和健康检查。代码发布不会读取或删除 `shared/` 生产数据。详细安装说明见 [`ops/README.md`](ops/README.md)。

## 本地开发

```bash
git clone https://github.com/YChaiyi/ZNTXFD.git
cd ZNTXFD
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

干净 clone 不包含生产内容。开发服务器可读取本机的 `data/` 与 `public/digest-images/`；也可通过 `ZNT_CONTENT_DIR` 指向一个带有效 `manifest.json` 的内容版本。生产运行时必须配置 `ZNT_CONTENT_DIR`，不会回退到仓库数据。

## 环境变量

生产运行变量保存在 VPS 的 `/var/www/znt.group/shared/runtime/app.env`，不得提交到 Git：

| 变量 | 用途 |
|---|---|
| `ACCESS_PASSWORD` | 网站固定访问密码 |
| `ACCESS_SESSION_SECRET` | 签名 7 天访问 Cookie 的独立随机密钥 |
| `ZNT_CONTENT_DIR` | 活动内容目录，生产为 `shared/content/current` |
| `TOKEN_RANK_STORE_PATH` | Token Rank 持久化文件，生产必须位于 `shared/` |
| `BUILD_SHA` | 当前代码版本，由部署流程设置 |

日报工作站可按需配置：

| 变量 | 用途 |
|---|---|
| `GROUP_DIGEST_RUNTIME` | 群精华运行目录；未设置时使用当前用户主目录下的 `.group-digest-runtime` |
| `ZNT_SITE_DIR` | 日报工作站上的正式项目目录，仅供本机操作说明使用 |
| `ZNT_SITE_PASSWORD` | `site:verify` 登录密码；未设置时读取 `ACCESS_PASSWORD` |
| `ZNT_SITE_URL` | 验证站点；默认 `https://znt.group` |
| `ZNT_VPS_SSH_KEY` | 内容上传使用的 SSH 私钥路径 |
| `ZNT_VPS_KNOWN_HOSTS` | 包含已核验 VPS 主机公钥的 known_hosts 文件 |
| `ZNT_VPS_REMOTE` | 内容上传目标 SSH 账户与主机 |
| `ZNT_CONTENT_KEEP` | VPS 保留的内容版本数；默认 `30` |
| `ZNT_MAIN_REF` | 本机源码同步检查基准；默认 `origin/main` |

参考值见 [`.env.example`](.env.example)。真实密码、密钥和服务器环境文件不得复制进仓库。

GitHub `production` Environment 另需配置 `ZNT_DEPLOY_SSH_KEY`、`ZNT_DEPLOY_KNOWN_HOSTS`、`ZNT_DEPLOY_HOST` 和 `ZNT_DEPLOY_USER` 四个 Secrets。VPS 迁移和受限账户验收完成后，再将仓库变量 `ZNT_DEPLOY_ENABLED` 设为 `true`；这些值只用于发布精确代码 SHA，不应写入 `.env`。

## 项目结构

```text
src/                    Next.js 应用与服务端数据层
public/token-rank/      Token Rank 安装器和客户端
scripts/                日报生成、内容打包与 source-only 校验
ops/                    VPS、systemd、Nginx 和受限部署脚本模板
.github/workflows/      PR 校验与 main 代码发布
tests/                  自动化测试
data/                   本机生成内容，Git 忽略
public/digest-images/   本机生成图片，Git 忽略
```

## Token Rank 接入

注册后使用页面生成的专属命令：

```bash
curl -fsSL https://znt.group/token-rank/install.sh | bash -s -- \
  --token <专属令牌> \
  --endpoint https://znt.group/api/token-rank/upload
```

客户端只上报 Token 数量，不上传代码或对话内容。

## 开源协议

[MIT](LICENSE)
