async function loadAuthUI() {
  const authSection = document.getElementById('auth-section');

  chrome.storage.local.get(['auth_token', 'auth_user'], (result) => {
    if (result.auth_token && result.auth_user) {
      showSignedIn(authSection, result.auth_user);
    } else {
      showLoginForm(authSection);
    }
  });
}

function showLoginForm(container) {
  container.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'login-form';

  const userLabel = document.createElement('label');
  userLabel.textContent = 'Email';
  userLabel.className = 'form-label';

  const usernameInput = document.createElement('input');
  usernameInput.type = 'text';
  usernameInput.className = 'form-input';
  usernameInput.id = 'username';
  usernameInput.placeholder = 'you@company.com or priya';
  usernameInput.autocomplete = 'username';

  const passLabel = document.createElement('label');
  passLabel.textContent = 'Password';
  passLabel.className = 'form-label';

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'form-input';
  passwordInput.id = 'password';
  passwordInput.placeholder = '••••••••';
  passwordInput.autocomplete = 'current-password';

  const button = document.createElement('button');
  button.textContent = 'Sign in';
  button.className = 'btn btn-primary';
  button.onclick = () =>
    handleLogin(usernameInput.value.trim(), passwordInput.value);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.innerHTML =
    '<strong>Required:</strong> Use the same email/username and password as the web app. ' +
    'Signing into the web app alone is not enough. Demo: priya / demo123';

  form.appendChild(userLabel);
  form.appendChild(usernameInput);
  form.appendChild(passLabel);
  form.appendChild(passwordInput);
  form.appendChild(button);
  form.appendChild(hint);

  container.appendChild(form);
}

async function handleLogin(username, password) {
  if (!username || !password) {
    alert('Enter username and password');
    return;
  }

  try {
    // Get backend URL from storage or default to the deployed backend
    const backendUrl = await new Promise((resolve) => {
      chrome.storage.local.get('backendUrl', (result) => {
        resolve(result.backendUrl || 'https://ai-audit-trail.onrender.com');
      });
    });

    const response = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.detail || 'Login failed');
    }

    chrome.storage.local.set(
      {
        auth_token: data.token,
        auth_user: data.user,
      },
      () => {
        loadAuthUI();
      }
    );
  } catch (error) {
    alert(`Login failed: ${error.message}`);
  }
}

function showSignedIn(container, user) {
  container.innerHTML = '';

  const section = document.createElement('div');
  section.className = 'signin-section';

  const message = document.createElement('p');
  message.className = 'signin-message';
  message.textContent = `Signed in as: ${user.display_name} (@${user.username || 'user'})`;

  const button = document.createElement('button');
  button.textContent = 'Sign out';
  button.className = 'btn btn-secondary';
  button.onclick = () => {
    chrome.storage.local.remove(['auth_token', 'auth_user'], () => {
      loadAuthUI();
    });
  };

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Captures Copilot / Claude chat messages via the Chrome debugger.';
  hint.style.color = '#16a34a';
  hint.style.fontWeight = '500';

  section.appendChild(message);
  section.appendChild(button);
  section.appendChild(hint);

  container.appendChild(section);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

const MONITORED_HOST = /^(https?):\/\/(copilot\.microsoft\.com|github\.com|claude\.ai)/i;

function renderStatus() {
  const line = document.getElementById('status-line');
  if (!line) return;

  chrome.runtime.sendMessage({ type: 'PING_CAPTURE' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      line.innerHTML =
        '<span class="dot"></span><span>Detector: Active (open Claude/Copilot to capture)</span>';
      return;
    }
    if (response.lastError) {
      line.innerHTML =
        '<span class="dot dot-warn"></span><span>Capture error: ' + escapeHtml(response.lastError) + '</span>';
      return;
    }
    const parts = ['Detector: Active'];
    if (response.attached) {
      parts.push('· debugger attached');
    }
    if (response.lastCaptureAt) {
      const secs = Math.max(0, Math.round((Date.now() - response.lastCaptureAt) / 1000));
      parts.push(
        '· Last capture ' + (secs < 60 ? secs + 's ago' : Math.round(secs / 60) + 'm ago')
      );
    }
    if (response.diag) {
      parts.push(
        `· ws:${response.diag.wsCreated}/${response.diag.sent}/${response.diag.recv}` +
          ` in:${response.diag.inputs} cap:${response.diag.captures}`
      );
    }
    line.innerHTML = '<span class="dot"></span><span>' + escapeHtml(parts.join(' ')) + '</span>';
  });
}

// Backend URL Configuration

document.addEventListener('DOMContentLoaded', () => {
  loadAuthUI();
});
renderStatus();
window.setInterval(renderStatus, 2000);