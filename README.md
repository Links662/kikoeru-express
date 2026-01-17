# Kikoeru
一个同人音声专用的音乐流媒体服务器。

## 功能介绍
- 从 DLSite 爬取音声元数据
- 对音声标记进度、打星、写评语
- 通过标签或关键字快速检索想要找到的音声
- 根据音声元数据对检索结果进行排序
- 可以选择通过 JWT 验证用户或关闭用户认证功能
- 支持在 Web 端修改配置文件和扫描音声库
- 支持为音声库添加多个根文件夹
- 支持历史记录功能

## 安装

### 源码安装
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

手动编译构建镜像
```bash
docker build -t links/kikoeru-dev .
```

调整`docker-compose.yml`内的挂载位置，启动服务
```bash
docker compose up -d
```

## 技术栈
- axios (网络请求)
- express (构建后端服务)
- sqlite3 (文件型数据库)
- knexjs (操作数据库)
- cheerio (将 html 解析为 jQuery 对象)
- jsonwebtoken (用户认证)
- socket.io (用于将扫描音声库的结果实时传给客户端)
- lrc-file-parser (解析播放LRC歌词文件)
- jschardet (判断文本文件编码)
- child_process (nodejs 子进程)
- pkg (打包为可执行文件)


## 项目目录结构
```
├── routes/                  # 主要路由
├── config/                  # 存放配置文件
├── covers/                  # 存放音声封面
├── database/                # 操作数据库相关代码
├── dist/                    # 存放前端项目 kikoeru-quasar 构建的 PWA
├── filesystem/              # 存放扫描相关代码
├── package/                 # 存放 pkg 打包后的可执行文件
├── package-macos/           # 存放 pkg 打包后的可执行文件
├── scraper/                 # 存放爬虫相关代码
├── sqlite/                  # 存放 sqlite 数据库文件
├── static/                  # 存放静态资源
├── .gitignore               # git 忽略路径
├── .dockerignore            # Docker 忽略路径
├── api.js                   # 为 express 实例添加路由与 jwt 验证中间件
├── app.js                   # 项目入口文件
├── socket.js                # 用于初始化socket.io
├── config.js                # 用于生成与修改 config.json 配置文件，导出公共配置以及升级锁
├── Dockerfile               # 用于构建 docker 镜像的文本文件
├── docker-compose.yml       # 用于使用docker-compose一键构建环境
├── package.json             # npm 脚本和依赖项
├── eslintrc.json            # ESLint
```

## 其他
### TODO
- [x] 接口性能优化，从3s优化到60ms

### 感谢
本项目的大部分后端代码来自于开源项目 [kikoeru](https://github.com/nortonandrews/kikoeru)

### 声明
本项目作为开源软件，本身不包含任何版权内容或其它违反法律的内容。项目中的程序是为了个人用户管理自己所有的合法数据资料而设计的。  
程序作者并不能防止内容提供商（如各类网站）或其它用户使用本程序提供侵权或其它非法内容。程序作者与使用本程序的各类内容提供商并无联系，不为其提供技术支持，也不为其不当使用承担法律责任。

### 许可协议
GNU General Public License v3.0
