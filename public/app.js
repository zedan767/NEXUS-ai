
const $ = s => document.querySelector(s);

const authScreen = $('#auth-screen');
const app = $('#app');
const sidebar = $('#sidebar');
const welcome = $('#welcome');
const chatArea = $('#chat-area');
const messagesEl = $('#messages');
const input = $('#message-input');
const sendBtn = $('#send-btn');
const convList = $('#conversation-list');
const fileInput = $('#image-input');

let user = null;
let conversations = [];
let activeId = null;
let busy = false;
let firebaseAuth = null;
let pendingImages = [];

const STORAGE_KEY = 'nexus-ai-conversations-v1';
const MEMORY_KEY = 'nexus-ai-memory-v1';

const uid = () =>
  Math.random().toString(36).slice(2, 9) +
  Date.now().toString(36);

const escapeHtml = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

function toast(msg) {
  const t = $('#toast');
  if (!t) return;

  t.textContent = msg;
  t.classList.add('show');

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function readMemory() {
  try {
    return localStorage.getItem(MEMORY_KEY) || '';
  } catch {
    return '';
  }
}

function saveMemory(value) {
  try {
    localStorage.setItem(
      MEMORY_KEY,
      String(value || '').slice(0, 1600)
    );
  } catch {}

  updateMemoryUI();
}

function updateMemoryUI() {
  const el = $('#memory-text');
  if (el) el.value = readMemory();

  const status = $('#memory-status');
  if (status) {
    status.textContent = readMemory()
      ? 'Memory is saved on this device and can be used in future chats.'
      : 'Memory is empty. It will learn useful details from your chats.';
  }
}

function loadConversations() {
  try {
    conversations = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '[]'
    );
  } catch {
    conversations = [];
  }

  renderConversationList();
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(conversations)
    );
  } catch {
    toast('Storage is full. Consider deleting older conversations.');
  }
}

function activeConversation() {
  return conversations.find(c => c.id === activeId);
}

function ensureConversation(firstText = 'New conversation') {
  if (!activeConversation()) {
    const c = {
      id: uid(),
      title: firstText.slice(0, 42) || 'New conversation',
      messages: [],
      updated: Date.now()
    };

    conversations.unshift(c);
    activeId = c.id;
    persist();
    renderConversationList();
  }

  return activeConversation();
}

function renderConversationList() {
  if (!convList) return;

  convList.innerHTML = '';

  const sorted = [...conversations].sort(
    (a, b) => b.updated - a.updated
  );

  if (!sorted.length) {
    convList.innerHTML =
      '<div style="padding:10px 8px;color:#8a8798;font-size:11px;line-height:1.7">Your conversations will appear here.</div>';
    return;
  }

  for (const c of sorted) {
    const row = document.createElement('div');

    row.className =
      'conversation-item' +
      (c.id === activeId ? ' selected' : '');

    row.innerHTML = `
      <span>◌</span>
      <span class="conv-title">${escapeHtml(c.title || 'New conversation')}</span>
      <button class="conv-delete"
        title="Delete conversation"
        aria-label="Delete conversation">×</button>
    `;

    row.addEventListener('click', e => {
      if (e.target.closest('.conv-delete')) {
        e.stopPropagation();
        deleteConversation(c.id);
        return;
      }

      openConversation(c.id);
    });

    convList.appendChild(row);
  }
}

function deleteConversation(id) {
  conversations = conversations.filter(c => c.id !== id);

  if (activeId === id) {
    activeId = null;
    showWelcome();
  }

  persist();
  renderConversationList();
}

function showWelcome() {
  welcome.classList.remove('hidden');
  chatArea.classList.add('hidden');
  messagesEl.innerHTML = '';
  activeId = null;
  renderConversationList();
}

function openConversation(id) {
  activeId = id;

  const c = activeConversation();
  if (!c) return;

  welcome.classList.add('hidden');
  chatArea.classList.remove('hidden');
  messagesEl.innerHTML = '';

  c.messages.forEach(m => {
    renderMessage(
      m.role,
      m.content,
      false,
      m.imageData || m.images?.[0]?.data,
      m.imageName || m.images?.[0]?.name
    );
  });

  renderConversationList();
  scrollChat();
  closeSidebar();
}

function startNewChat() {
  showWelcome();
  input.value = '';
  pendingImages = [];
  renderPendingImages();
  resizeInput();
  updateCount();
  input.focus();
  closeSidebar();
}

function formatContent(text) {
  const escaped = escapeHtml(text);

  return escaped
    .split(/```/)
    .map((part, i) => {
      if (i % 2) {
        return `<pre><code>${part.replace(/^\w+\n/, '')}</code></pre>`;
      }

      return part
        .split(/\n{2,}/)
        .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('');
    })
    .join('');
}

function renderMessage(
  role,
  content,
  addActions = true,
  imageData = null,
  imageName = 'image.png'
) {
  const row = document.createElement('article');

  row.className =
    'message ' + (role === 'user' ? 'user' : 'assistant');

  const avatar =
    role === 'user'
      ? (user?.displayName?.[0] || 'Z')
      : '✳';

  row.innerHTML = `
    <div class="message-avatar">${escapeHtml(avatar)}</div>
    <div class="message-content">${formatContent(content || '')}</div>
  `;

  const body = row.querySelector('.message-content');

  if (imageData) {
    const img = document.createElement('img');
    img.className = 'message-image';
    img.src = imageData;
    img.alt = role === 'assistant'
      ? 'Generated image'
      : 'Uploaded image';

    body.appendChild(img);
  }

  if (role === 'assistant' && addActions) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = '<button data-copy>▢ Copy response</button>';

    actions.querySelector('[data-copy]').onclick = async () => {
      try {
        await navigator.clipboard.writeText(String(content || ''));
        toast('Copied to clipboard');
      } catch {
        toast('Clipboard unavailable in this browser');
      }
    };

    if (imageData) {
      const download = document.createElement('button');
      download.type = 'button';
      download.textContent = '↓ Download image';

      download.onclick = () => {
        downloadImage(
          imageData,
          imageName || 'nexus-ai-image.png'
        );
      };

      actions.appendChild(download);
    }

    body.appendChild(actions);
  }

  messagesEl.appendChild(row);
  return row;
}

function downloadImage(src, name) {
  try {
    const a = document.createElement('a');
    a.href = src;
    a.download = (name || 'nexus-ai-image.png')
      .replace(/[^a-z0-9._-]/gi, '-');
    a.rel = 'noopener';

    document.body.appendChild(a);
    a.click();
    a.remove();

    toast('Download started');
  } catch {
    toast('Could not download this image on this browser');
  }
}

function scrollChat() {
  chatArea.scrollTop = chatArea.scrollHeight;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateCount() {
  $('#input-count').textContent =
    `${input.value.length} / 4000`;

  sendBtn.disabled =
    busy || (!input.value.trim() && !pendingImages.length);
}

function closeSidebar() {
  sidebar.classList.remove('open');
  $('#overlay').classList.remove('show');
  document.body.classList.remove('sidebar-open');
}

function openSidebar() {
  sidebar.classList.add('open');
  $('#overlay').classList.add('show');
  document.body.classList.add('sidebar-open');
}

function setUser(u) {
  user = u;

  $('#user-name').textContent =
    u?.displayName || 'Guest explorer';

  $('#user-email').textContent =
    u?.email || 'Saved on this device';

  $('#user-avatar').textContent =
    (u?.displayName || 'Z').slice(0, 1).toUpperCase();

  authScreen.classList.add('hidden');
  app.classList.remove('hidden');

  loadConversations();
  updateMemoryUI();
}

function signOut() {
  if (!user || user.email === 'Saved on this device') {
    user = null;
    app.classList.add('hidden');
    authScreen.classList.remove('hidden');
    closeSidebar();
    return;
  }

  if (firebaseAuth) {
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
      .then(m => m.signOut(firebaseAuth))
      .catch(() => {});
  } else {
    user = null;
    app.classList.add('hidden');
    authScreen.classList.remove('hidden');
    closeSidebar();
  }
}

async function setupFirebase() {
  try {
    const r = await fetch('/api/config');
    const cfg = await r.json();

    const f = cfg.firebase || {
      apiKey: cfg.firebaseApiKey || '',
      authDomain: cfg.firebaseAuthDomain || '',
      projectId: cfg.firebaseProjectId || '',
      storageBucket: cfg.firebaseStorageBucket || '',
      messagingSenderId: cfg.firebaseMessagingSenderId || '',
      appId: cfg.firebaseAppId || ''
    };

    if (!f.apiKey || !f.authDomain || !f.projectId || !f.appId) {
      $('#auth-note').textContent =
        'Google sign-in needs Firebase setup. Guest mode is ready to use.';
      return;
    }

    const appMod = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'
    );

    const authMod = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
    );

    const fb = appMod.getApps().length
      ? appMod.getApp()
      : appMod.initializeApp(f);

    firebaseAuth = authMod.getAuth(fb);

    await authMod.setPersistence(
      firebaseAuth,
      authMod.browserLocalPersistence
    );

    const provider = () => {
      const p = new authMod.GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      return p;
    };

    $('#google-login').onclick = async () => {
      try {
        const result = await authMod.signInWithPopup(
          firebaseAuth,
          provider()
        );

        rememberAccount(result.user);
        setUser(result.user);
      } catch (e) {
        toast(e.message || 'Google sign-in failed');
      }
    };

    $('#switch-account').onclick = async () => {
      if (!firebaseAuth) {
        toast('Google sign-in is not configured yet.');
        return;
      }

      try {
        const result = await authMod.signInWithPopup(
          firebaseAuth,
          provider()
        );

        rememberAccount(result.user);
        setUser(result.user);
        toast('Google account switched');
      } catch (e) {
        if (e.code !== 'auth/popup-closed-by-user') {
          toast(e.message || 'Could not switch account');
        }
      }
    };

    authMod.onAuthStateChanged(firebaseAuth, u => {
      if (u) {
        rememberAccount(u);
        setUser(u);
      } else if (user && user.email !== 'Saved on this device') {
        user = null;
        app.classList.add('hidden');
        authScreen.classList.remove('hidden');
        closeSidebar();
      }
    });

    $('#auth-note').textContent =
      'Sign in with Google. Nexus AI remembers your login on this device.';
  } catch {
    $('#auth-note').textContent =
      'Could not load sign-in settings. Guest mode is available.';
  }
}

function rememberAccount(u) {
  try {
    const key = 'nexus-ai-google-accounts-v1';

    let list = JSON.parse(localStorage.getItem(key) || '[]');

    list = list.filter(a => a.email !== u.email);

    list.unshift({
      email: u.email || '',
      displayName: u.displayName || 'Google user',
      photoURL: u.photoURL || ''
    });

    localStorage.setItem(key, JSON.stringify(list.slice(0, 2)));
  } catch {}
}

function renderPendingImages() {
  const wrap = $('#attachment-preview');
  if (!wrap) return;

  wrap.innerHTML = '';

  pendingImages.forEach((img, i) => {
    const item = document.createElement('div');
    item.className = 'attachment-chip';

    item.innerHTML = `
      <img src="${img.data}" alt="Selected image">
      <button type="button" aria-label="Remove image"
        title="Remove image">×</button>
    `;

    item.querySelector('button').onclick = () => {
      pendingImages.splice(i, 1);
      renderPendingImages();
      updateCount();
    };

    wrap.appendChild(item);
  });

  wrap.classList.toggle('hidden', !pendingImages.length);
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 12 MB.');
  }

  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(new Error('Could not read that image.'));

    reader.readAsDataURL(file);
  });

  if (!window.createImageBitmap) {
    return { data, name: file.name };
  }

  try {
    const bitmap = await createImageBitmap(file);

    const scale = Math.min(
      1,
      1200 / Math.max(bitmap.width, bitmap.height)
    );

    const canvas = document.createElement('canvas');

    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    canvas.getContext('2d').drawImage(
      bitmap,
      0,
      0,
      canvas.width,
      canvas.height
    );

    bitmap.close?.();

    return {
      data: canvas.toDataURL('image/jpeg', 0.78),
      name: file.name
    };
  } catch {
    return { data, name: file.name };
  }
}

async function handleFiles(files) {
  for (
    const file of Array.from(files || [])
      .slice(0, 4 - pendingImages.length)
  ) {
    try {
      pendingImages.push(await compressImage(file));
    } catch (e) {
      toast(e.message);
    }
  }

  if (files?.length > 4) {
    toast('You can attach up to 4 images per message.');
  }

  renderPendingImages();
  updateCount();
  fileInput.value = '';
}

function imageRequest(text) {
  return /\b(generate|create|make|draw|design|produce)\b.{0,60}\b(image|picture|photo|illustration|wallpaper|artwork)\b|\b(generate|create|make|draw)\s+(me\s+)?(an?\s+)?(image|picture|photo|wallpaper|illustration)\b/i.test(text);
}

async function readResponse(response) {
  let data = {};

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `The server returned an invalid response (${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      data.details ||
      data.error ||
      data.message ||
      `Request failed (${response.status})`
    );
  }

  if (!data || typeof data !== 'object') {
    throw new Error('The server returned an unexpected response.');
  }

  return data;
}

async function generateImage(text, c) {
  const typing = document.createElement('article');
  typing.className = 'message';

  typing.innerHTML = `
    <div class="message-avatar">✳</div>
    <div class="message-content">
      <div class="typing"><i></i><i></i><i></i></div>
      <p>Creating your image…</p>
    </div>
  `;

  messagesEl.appendChild(typing);
  scrollChat();

  try {
    const data = await readResponse(
      await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          width: 1024,
          height: 1024
        })
      })
    );

    typing.remove();

    if (typeof data.image !== 'string' || !data.image) {
      throw new Error('The image provider did not return an image.');
    }

    const imageData = data.image.startsWith('data:')
      ? data.image
      : `data:${data.mimeType || 'image/png'};base64,${data.image}`;

    c.messages.push({
      role: 'assistant',
      content: 'Here is your generated image.',
      imageData,
      imageName: 'nexus-ai-generated.png'
    });

    c.updated = Date.now();
    persist();

    renderMessage(
      'assistant',
      'Here is your generated image.',
      true,
      imageData,
      'nexus-ai-generated.png'
    );

    renderConversationList();
  } catch (e) {
    typing.remove();

    const err = `Image generation failed. ${e.message}`;

    c.messages.push({ role: 'assistant', content: err });
    c.updated = Date.now();
    persist();

    renderMessage('assistant', err);
    toast('Image generation issue');
  }
}

async function updateMemory(c) {
  const userMessages = c.messages
    .filter(m => m.role === 'user' && m.content)
    .slice(-10);

  if (!userMessages.length) return;

  try {
    const response = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memory: readMemory(),
        messages: c.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-12)
          .map(m => ({
            role: m.role,
            content: m.content
          }))
      })
    });

    if (!response.ok) return;

    const data = await response.json();

    if (typeof data.memory === 'string' && data.memory.trim()) {
      saveMemory(data.memory.trim());
    }
  } catch {
    // Memory updates are best-effort; chat still works.
  }
}

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}

async function sendMessage(text) {
  if (busy) return;

  text = String(text || '').trim();

  if (!text && !pendingImages.length) return;

  if (text.length > 4000) {
    toast('Please keep messages under 4,000 characters.');
    return;
  }

  const attached = pendingImages.slice();

  const visibleText =
    text || (attached.length ? 'What is in this image?' : '');

  const c = ensureConversation(visibleText);

  if (!c.messages.length) {
    c.title = visibleText.length > 42
      ? visibleText.slice(0, 39) + '…'
      : visibleText;
  }

  c.messages.push({
    role: 'user',
    content: visibleText,
    images: attached.map(x => ({
      data: x.data,
      name: x.name
    }))
  });

  c.updated = Date.now();
  persist();

  welcome.classList.add('hidden');
  chatArea.classList.remove('hidden');

  renderMessage(
    'user',
    visibleText,
    true,
    attached[0]?.data,
    attached[0]?.name
  );

  if (attached.length > 1) {
    const extra = document.createElement('div');
    extra.className = 'extra-images-note';
    extra.textContent = `${attached.length} images attached`;

    messagesEl.lastElementChild
      ?.querySelector('.message-content')
      ?.appendChild(extra);
  }

  input.value = '';
  pendingImages = [];

  renderPendingImages();
  resizeInput();
  updateCount();
  renderConversationList();

  const typing = document.createElement('article');
  typing.className = 'message';

  typing.innerHTML = `
    <div class="message-avatar">✳</div>
    <div class="message-content">
      <div class="typing"><i></i><i></i><i></i></div>
    </div>
  `;

  messagesEl.appendChild(typing);

  busy = true;
  updateCount();
  scrollChat();

  try {
    if (!attached.length && imageRequest(text)) {
      typing.remove();
      await generateImage(text, c);
      return;
    }

    const memory = readMemory();

    const system =
      'You are Nexus AI, a helpful, thoughtful, accurate assistant. ' +
      'Use clear structure and concise explanations. Format code in fenced code blocks. ' +
      'If the user attaches an image, inspect it and answer based on visible contents. ' +
      'Use the saved memory as background context, but do not assume it is always current.' +
      '\n\nSaved user memory:\n' +
      (memory || '(No saved memory yet)');

    const history = c.messages.slice(-24).map(m => {
      if (
        m.role === 'user' &&
        Array.isArray(m.images) &&
        m.images.length
      ) {
        const content = [
          {
            type: 'text',
            text: m.content || 'Please inspect this image.'
          },
          ...m.images.slice(0, 4).map(x => ({
            type: 'image_url',
            image_url: { url: x.data }
          }))
        ];

        return { role: m.role, content };
      }

      return {
        role: m.role,
        content: m.content || ''
      };
    });

    const data = await readResponse(
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: system },
            ...history
          ]
        })
      })
    );

    typing.remove();

    // FIX: Read the actual reply returned by the backend.
    const reply =
      typeof data.reply === 'string' ? data.reply :
      typeof data.answer === 'string' ? data.answer :
      typeof data.response === 'string' ? data.response :
      typeof data.message === 'string' ? data.message :
      typeof data.content === 'string' ? data.content :
      '';

    if (!reply.trim()) {
      throw new Error(
        'The server returned no readable reply. Response: ' +
        JSON.stringify(data)
      );
    }

    c.messages.push({
      role: 'assistant',
      content: reply
    });

    c.updated = Date.now();
    persist();

    renderMessage('assistant', reply);
    renderConversationList();

    if (
      c.messages.filter(m => m.role === 'user').length % 4 === 0
    ) {
      updateMemory(c);
    }
  } catch (e) {
    typing.remove();

    const err = `I couldn't get a response. ${e.message}`;

    c.messages.push({
      role: 'assistant',
      content: err
    });

    c.updated = Date.now();
    persist();

    renderMessage('assistant', err);
    renderConversationList();

    toast('AI connection issue');
  } finally {
    busy = false;
    updateCount();
    scrollChat();
  }
}

$('#guest-login').addEventListener('click', () => {
  setUser({
    displayName: 'Guest explorer',
    email: 'Saved on this device'
  });
});

$('#new-chat').addEventListener('click', startNewChat);
$('#close-sidebar').addEventListener('click', closeSidebar);
$('#open-sidebar').addEventListener('click', openSidebar);
$('#overlay').addEventListener('click', closeSidebar);

$('#send-btn').addEventListener('click', () => {
  sendMessage(input.value);
});

input.addEventListener('input', () => {
  resizeInput();
  updateCount();
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(input.value);
  }
});

document.querySelectorAll('[data-prompt]').forEach(b => {
  b.addEventListener('click', () => {
    input.value = b.dataset.prompt;
    updateCount();
    sendMessage(input.value);
  });
});

$('#clear-history').addEventListener('click', () => {
  if (!conversations.length) {
    toast('No conversations to clear');
    return;
  }

  if (confirm('Delete all saved conversations on this device?')) {
    conversations = [];
    activeId = null;
    persist();
    renderConversationList();
    showWelcome();
    toast('Conversation history cleared');
  }
});

$('#logout').addEventListener('click', signOut);

$('#footer-year').textContent = new Date().getFullYear();

$('#theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('light');

  localStorage.setItem(
    'nexus-ai-theme',
    document.body.classList.contains('light') ? 'light' : 'dark'
  );
});

$('#attach-btn').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
});

$('#nav-chat').addEventListener('click', startNewChat);

$('#nav-explore').addEventListener('click', () => {
  startNewChat();
  toast('Choose a prompt card to get started.');
});

$('#memory-btn').addEventListener('click', () => {
  $('#memory-modal').classList.remove('hidden');
  updateMemoryUI();
  closeSidebar();
});

$('#memory-close').addEventListener('click', () => {
  $('#memory-modal').classList.add('hidden');
});

$('#memory-save').addEventListener('click', () => {
  saveMemory($('#memory-text').value);
  $('#memory-modal').classList.add('hidden');
  toast('Memory saved');
});

$('#memory-clear').addEventListener('click', () => {
  if (confirm('Clear saved AI memory? Your conversation history will not be deleted.')) {
    saveMemory('');
    toast('Saved memory cleared');
  }
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    startNewChat();
  }

  if (e.key === 'Escape') {
    closeSidebar();
    $('#memory-modal').classList.add('hidden');
  }
});

if (localStorage.getItem('nexus-ai-theme') === 'light') {
  document.body.classList.add('light');
}

setupFirebase();
updateCount();
updateMemoryUI();
