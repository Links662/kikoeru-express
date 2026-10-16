# Kikoeru
一个同人音声专用的音乐流媒体服务器。

## 功能介绍
- 从 DLSite 爬取音声元数据
- 对音声标记进度、打星、写评语
- 通过标签或关键字快速检索想要找到的音声
- 根据音声元数据对检索结果进行排序
- 可以选择通过 JWT 验证用户或关闭用户认证功能
- 用户管理：新增 / 删除用户、修改密码，以及「禁用 / 启用」账号（内置 admin 账号不可删除，但可以禁用）
- 用户组只有 user / administrator 两种（原 guest 组已取消，残留账号启动时自动归到 user）
- 支持在 Web 端修改配置文件和扫描存储位置
- 支持添加多个根文件夹作为存储位置
- 支持历史记录功能
- 收藏社团 / 标签 / 声优，收藏数据按用户隔离
- 封面维护：补齐缺失封面、重建过期缩略图、把本地生成的降级图升级为 DLsite 原图

## 安装

### 源码安装

需要 Node.js 22 及以上（见 `package.json` 的 `engines`）。

#### 后端安装
```bash
# 安装依赖
npm install
# 启动服务器
npm start
# Express listening on http://[::]:8888
```

#### 前端启动
参照kikoeru-quasar文档启动前端。

### Docker安装
将kikoeru-quasar源码文件夹复制到kikoeru-express文件夹内，目录结构如下：

```bash
kikoeru-express
├── ...
├── kikoeru-quasar
└── ...
```

Windows 下同步前端源码（跳过缓存目录，避免每次复制 500MB 的 node_modules；`/MIR` 会删除目标目录里多余的旧文件）：

```powershell
robocopy ..\kikoeru-quasar .\kikoeru-quasar /MIR /XD node_modules .git dist .quasar
```

手动编译构建镜像
```bash
docker build -t links/kikoeru-dev .
```

调整`docker-compose.yml`内的挂载位置，启动服务
```bash
docker compose up -d
```

#### 构建缓存说明

- 构建日志里的 `load metadata for docker.io/library/node:14-alpine` 只是向 registry 校验 tag，本地已有该镜像时不会重新下载；出现 `Pulling fs layer` / `Downloading` 才是真的在下载。
- `docker system prune -a`、`docker image prune -a` 会把 `node:14-alpine` 一起删掉，下次构建必然重新下载。日常清理用 `docker builder prune` 或 `docker system prune`（不加 `-a`）。
- 用 `docker buildx` 的 docker-container 构建器（多平台构建走的就是这条路）时，镜像存在构建器容器里，`docker images` 里看不到；构建器被重建或清理后基础镜像会重新下载，属于正常现象。
- npm 依赖默认走 npmmirror，需要官方源时：`docker build --build-arg NPM_REGISTRY=https://registry.npmjs.org -t links/kikoeru-dev .`

## 技术栈
- axios (网络请求)
- express (构建后端服务)
- sqlite3 (文件型数据库)
- knexjs (操作数据库)
- cheerio (将 html 解析为 jQuery 对象)
- jsonwebtoken (用户认证)
- crypto.scrypt (密码哈希，Node 内置，无需原生编译)
- socket.io (用于将扫描存储位置的结果实时传给客户端)
- lrc-file-parser (解析播放LRC歌词文件)
- jschardet (判断文本文件编码)
- jimp (本地生成封面缩略图)
- yargs (扫描 / 封面维护脚本的命令行参数)
- child_process (nodejs 子进程)


## 项目目录结构
```
├── auth/                    # JWT 签发与校验工具
├── routes/                  # 主要路由
├── config/                  # 存放配置文件
├── covers/                  # 存放音声封面
├── database/                # 操作数据库相关代码
├── dist/                    # 存放前端项目 kikoeru-quasar 构建的 PWA
├── filesystem/              # 存放扫描相关代码
├── state/                   # 存放常驻进程级状态
│   └── scannerState.js      # 扫描子进程的唯一状态源，供 socket 广播与 /api/scanner/state 查询
├── scraper/                 # 存放爬虫相关代码
├── sqlite/                  # 存放 sqlite 数据库文件
├── static/                  # 存放静态资源
├── test/                    # mocha 测试（含封面维护用例）
├── VoiceWork/               # 默认挂载进来的音声库目录
├── .gitignore               # git 忽略路径
├── .dockerignore            # Docker 忽略路径
├── api.js                   # 为 express 实例添加路由与 jwt 验证中间件
├── app.js                   # 项目入口文件
├── socket.js                # 用于初始化socket.io
├── config.js                # 用于生成与修改 config.json 配置文件，导出公共配置以及升级锁
├── Dockerfile               # 用于构建 docker 镜像的文本文件
├── docker-compose.yml       # 用于使用docker-compose一键构建环境
├── package.json             # npm 脚本和依赖项
├── .eslintrc.json           # ESLint
```

## 其他
### TODO
- [x] 接口性能优化，从3s优化到60ms
- [x] 新增收藏功能：支持收藏社团 / 标签 / 声优，收藏数据按用户隔离（新增 `t_favourite` 表与收藏接口）
- [x] 历史记录改为每个作品仅保留一条记录：`t_history` 改用 `(work_id, user_name)` 联合主键，写入使用 `ON CONFLICT` 覆盖更新
- [x] 数据库外键补充级联更新 / 删除（`t_work`、`r_tag_work`、`t_review`、`t_history` 等），dbVersion 升级至 20261012
- [x] Dockerfile 构建改用 npmmirror 镜像源加速依赖安装
- [x] 依赖整体升级，Node.js 要求提升至 22
- [x] 新增封面维护功能
- [x] 用户管理安全加固：新增「禁用 / 启用账号」；被禁用 / 被删除 / 用户组变更的账号立即失效；删除与禁用都要求至少保留一个已启用的管理员，避免把管理后台锁死；
- [x] 密码哈希从单轮 salted md5 换成 scrypt（Node 内置，N=2^17 / r=8 / p=1；老 md5 哈希不再接受，需用重置模式重设密码）
- [x] 新增「密码重置模式」救援通道：`KIKOERU_PASSWORD_RESET=1` 启动后只提供重置页面，需一次性令牌、仅限 administrator、一次窗口只成功一次


### 感谢
本项目的大部分后端代码来自于开源项目 [kikoeru](https://github.com/nortonandrews/kikoeru)

### 声明
本项目作为开源软件，本身不包含任何版权内容或其它违反法律的内容。项目中的程序是为了个人用户管理自己所有的合法数据资料而设计的。  
程序作者并不能防止内容提供商（如各类网站）或其它用户使用本程序提供侵权或其它非法内容。程序作者与使用本程序的各类内容提供商并无联系，不为其提供技术支持，也不为其不当使用承担法律责任。

### 许可协议
GNU General Public License v3.0
