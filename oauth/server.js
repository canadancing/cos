const http = require('http');
const url = require('url');

const PORT = parseInt(process.env.PORT || '3006', 10);
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://cos.reopenai.net/api/auth/callback';

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Health check endpoint
  if (pathname === '/api/auth/health' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      hasClientId: Boolean(GITHUB_CLIENT_ID),
      hasClientSecret: Boolean(GITHUB_CLIENT_SECRET),
      redirectUri: REDIRECT_URI
    }));
    return;
  }

  // 2. Initial OAuth authorization request from Decap CMS popup
  if (pathname === '/api/auth') {
    if (!GITHUB_CLIENT_ID) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <div style="font-family:sans-serif;max-width:550px;margin:40px auto;padding:24px;border:1px solid #ef4444;border-radius:12px;background:#fef2f2;color:#991b1b;">
          <h2 style="margin-top:0;">GitHub OAuth Not Configured Yet</h2>
          <p>Please enter your <code>GITHUB_CLIENT_ID</code> and <code>GITHUB_CLIENT_SECRET</code> in <code>/home/ubuntu/cos-oauth/.env</code>.</p>
        </div>
      `);
      return;
    }

    const state = Math.random().toString(36).substring(2);
    const authUrl = 'https://github.com/login/oauth/authorize' +
      '?client_id=' + encodeURIComponent(GITHUB_CLIENT_ID) +
      '&scope=repo,user' +
      '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
      '&state=' + encodeURIComponent(state);

    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }

  // 3. OAuth Callback from GitHub
  if (pathname === '/api/auth/callback') {
    const code = parsedUrl.query.code;
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code parameter from GitHub OAuth');
      return;
    }

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code: code,
          redirect_uri: REDIRECT_URI
        })
      });

      const data = await tokenRes.json();
      if (data.error || !data.access_token) {
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>GitHub Authentication Failed</h3><p>' + (data.error_description || data.error) + '</p>');
        return;
      }

      const token = data.access_token;
      const tokenJson = JSON.stringify({ token: token, provider: 'github' });
      const html = `<!doctype html>
<html>
<body>
<script>
(function() {
  function receiveMessage(e) {
    window.opener.postMessage(
      'authorization:github:success:${tokenJson.replace(/'/g, "\\'")}',
      e.origin
    );
  }
  window.addEventListener("message", receiveMessage, false);
  window.opener.postMessage("authorizing:github", "*");
})()
</script>
<p style="font-family:sans-serif;text-align:center;padding:40px;">Authenticated successfully! You can close this popup.</p>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error communicating with GitHub: ' + err.message);
    }
    return;
  }

  // 4. GitHub Webhook auto-deploy endpoint
  if (pathname === '/api/webhook') {
    const { exec } = require('child_process');
    exec('git -C /var/www/cos-food fetch origin main && git -C /var/www/cos-food reset --hard origin/main', (error, stdout, stderr) => {
      if (error) {
        console.error('Webhook deploy failed:', error);
      } else {
        console.log('Webhook deploy succeeded:', stdout.trim());
      }
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'deployed' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Caribbean of Soul OAuth Service listening on 127.0.0.1:' + PORT);
});
