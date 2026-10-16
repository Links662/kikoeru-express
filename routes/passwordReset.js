const crypto = require('crypto');
const express = require('express');

const { hashPassword } = require('../auth/password');
const db = require('../database/db');

/*
 * 密码重置模式（救援通道）。
 *
 * 只有启动时带上 KIKOERU_PASSWORD_RESET=1 才会启用；这个进程只提供重置页面，
 * 不挂载任何业务接口（/api/... 在重置模式下不存在），也不初始化 socket。
 *
 * 三道限制：
 *   1. 必须带上启动时打印在控制台里的一次性令牌 —— 能看到服务日志的人才拿得到；
 *   2. 只能重置 administrator 组的账号，并顺手把它重新启用（先把管理权抢回来）；
 *   3. 一次窗口只成功一次，成功后窗口立即关闭；令牌连错 5 次也关闭。
 *      关闭后必须重启服务（并且去掉环境变量）才能再次开启。
 *
 * 用法：
 *   KIKOERU_PASSWORD_RESET=1 node app.js
 *   docker compose run --rm -e KIKOERU_PASSWORD_RESET=1 -p 8888:8888 kikoeru node app.js
 */
const RESET_MODE_ENV = 'KIKOERU_PASSWORD_RESET';
const MAX_FAILED_ATTEMPTS = 5;
const MIN_LENGTH = 5;

const resetToken = crypto.randomBytes(16).toString('hex');
let windowClosed = false;
let failedAttempts = 0;

const isResetMode = () => process.env[RESET_MODE_ENV] === '1';

const tokenMatches = (candidate) => {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;

  const expected = Buffer.from(resetToken, 'utf8');
  const actual = Buffer.from(candidate, 'utf8');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const closeWindow = (reason) => {
  windowClosed = true;
  console.warn(` ! 密码重置窗口已关闭（${reason}）。请重启服务并去掉 ${RESET_MODE_ENV} 后再正常使用。`);
};

const printResetInstructions = (port) => {
  console.log('');
  console.log('*** 密码重置模式 ***');
  console.log(` * 重置页面：http://<服务器地址>:${port}/`);
  console.log(` * 一次性令牌：${resetToken}`);
  console.log(' * 只能重置 administrator 账号；一次窗口只成功一次，重置完请重启服务（不带该环境变量）');
  console.log('');
};

const renderPage = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kikoeru 密码重置</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px; background: #fafafa; color: #222; }
  form { max-width: 380px; margin: 0 auto; display: grid; gap: 12px; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
  h1 { font-size: 18px; margin: 0; }
  p.hint { font-size: 12px; color: #666; margin: 0; line-height: 1.6; }
  label { font-size: 13px; display: grid; gap: 4px; }
  input { padding: 8px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
  button { padding: 10px; font-size: 14px; border: 0; border-radius: 4px; background: #1976d2; color: #fff; cursor: pointer; }
  #result { max-width: 380px; margin: 12px auto 0; font-size: 13px; line-height: 1.6; }
  #result.error { color: #c62828; }
  #result.ok { color: #2e7d32; }
</style>
</head>
<body>
  <form id="reset-form">
    <h1>重置管理员密码</h1>
    <p class="hint">只在重置模式下可用。令牌是启动服务时打印在控制台里的那串随机字符；一次窗口只成功一次，重置完请重启服务（不要带 KIKOERU_PASSWORD_RESET）。其余账号请在重新登录后到后台用户管理里修改。</p>
    <label>用户名<input name="name" autocomplete="off" required minlength="5" /></label>
    <label>新密码<input name="newPassword" type="password" required minlength="5" /></label>
    <label>一次性令牌<input name="token" autocomplete="off" required /></label>
    <button type="submit">重置密码</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('reset-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var form = event.target;
      var result = document.getElementById('result');
      result.className = '';
      result.textContent = '提交中...';

      fetch('/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.value,
          newPassword: form.newPassword.value,
          token: form.token.value
        })
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          return { ok: response.ok, data: data };
        });
      }).then(function (out) {
        result.textContent = out.data.message || out.data.error || '未知结果';
        result.className = out.ok ? 'ok' : 'error';
      }).catch(function (err) {
        result.textContent = '请求失败：' + err.message;
        result.className = 'error';
      });
    });
  </script>
</body>
</html>`;

const router = express.Router();

router.get('/', (req, res) => {
  if (windowClosed) {
    res.type('html').send('<p style="font-family:system-ui;padding:24px">重置窗口已关闭，请重启服务（不带该环境变量）后再操作。</p>');
    return;
  }

  res.type('html').send(renderPage());
});

router.post('/reset', async (req, res) => {
  if (windowClosed) {
    return res.status(403).send({ error: '重置窗口已关闭，请重启服务.' });
  }

  const body = req.body === undefined ? {} : req.body;

  if (!tokenMatches(body.token)) {
    failedAttempts += 1;
    console.warn(` ! 密码重置：令牌不正确（第 ${failedAttempts}/${MAX_FAILED_ATTEMPTS} 次）来自 ${req.ip}`);
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) closeWindow('令牌错误次数过多');
    return res.status(401).send({ error: '一次性令牌不正确.' });
  }

  const name = body.name;
  const newPassword = body.newPassword;

  if (typeof name !== 'string' || name.length < MIN_LENGTH
    || typeof newPassword !== 'string' || newPassword.length < MIN_LENGTH) {
    return res.status(422).send({ error: `用户名和新密码长度都至少为 ${MIN_LENGTH}.` });
  }

  try {
    const user = await db.getUserState(name);
    if (user === undefined) {
      return res.status(404).send({ error: `用户 ${name} 不存在.` });
    }
    if (user.group !== 'administrator') {
      return res.status(403).send({ error: '重置模式只能重置 administrator 账号，其余账号请在后台用户管理里修改.' });
    }

    await db.knex('t_user').where('name', '=', user.name).update({
      password: await hashPassword(newPassword),
      disabled: 0,
    });

    console.warn(` ! 密码重置：已重置 ${user.name} 的密码并启用该账号（来自 ${req.ip}）`);
    closeWindow(`已重置 ${user.name} 的密码`);

    res.send({
      message: `用户 ${user.name} 的密码已重置，账号已启用。请重启服务（不带 ${RESET_MODE_ENV}），然后用新密码登录。`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: '重置失败，请查看服务端日志.' });
  }
});

module.exports = { router, isResetMode, printResetInstructions };
