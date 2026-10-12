# This dockerfile generates a single-container application
# It builds the front-end from ./kikoeru-quasar and copies the artifacts into the back-end image
# If you want to separate the front-end from the back-end, it should work as well

# 构建上下文必须包含 kikoeru-quasar 目录（见 README：先把前端源码复制到本目录）
# npm 镜像源：默认走国内 npmmirror，需要用官方源时加 --build-arg NPM_REGISTRY=https://registry.npmjs.org
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM node:14-alpine AS build-dep

# Create app directory
WORKDIR /usr/src/kikoeru

# 编译 sqlite3 等原生模块需要 python / make / gcc
RUN apk update && apk add python3 make gcc g++

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
ARG NPM_REGISTRY
RUN npm config set registry ${NPM_REGISTRY}
COPY package*.json ./
RUN npm ci --only=production

# Build SPA and PWA
FROM node:14-alpine AS build-frontend
WORKDIR /frontend
# @quasar/app v1 requires node-ass, which takes 30 minutes to compile libsass in CI for arm64 and armv7
# So I prebuilt the binaries for arm64 and armv7
# @quasar/app v2 no longer uses this deprecated package, so this line will be removed in the future
ARG NPM_REGISTRY
RUN npm config set registry ${NPM_REGISTRY}
RUN npm install -g @quasar/cli@1.2.0

# 先只复制 package 文件以利用缓存
COPY ./kikoeru-quasar/package*.json ./
RUN npm ci

# 再复制源代码进行构建
COPY ./kikoeru-quasar .
RUN quasar build && quasar build -m pwa

# Final stage
FROM node:14-alpine
ENV IS_DOCKER=true
WORKDIR /usr/src/kikoeru

# 系统依赖与 tini（放在 COPY 源码之前，源码变动不会让这一层失效）
RUN apk add --no-cache tzdata tini && \
cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
echo "Asia/Shanghai" > /etc/timezone

# Copy build artifacts
COPY --from=build-dep /usr/src/kikoeru /usr/src/kikoeru
ARG FRONTEND_TYPE="pwa"
COPY --from=build-frontend /frontend/dist/${FRONTEND_TYPE} /usr/src/kikoeru/dist

# Bundle app source（放最后：源码或数据变动只让这一层失效）
COPY . .

ENTRYPOINT ["/sbin/tini", "--"]

# 持久化
VOLUME [ "/usr/src/kikoeru/sqlite", "/usr/src/kikoeru/config", "/usr/src/kikoeru/covers"]

EXPOSE 8888
CMD [ "node", "app.js" ]
