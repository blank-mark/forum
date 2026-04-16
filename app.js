
const firebaseConfig = {"apiKey": "AIzaSyBBVZQBK-hdRdSHVKm3gWNNbnVYA6trekQ", "authDomain": "sosylksoset.firebaseapp.com", "projectId": "sosylksoset", "storageBucket": "sosylksoset.firebasestorage.app", "messagingSenderId": "322929691356", "appId": "1:322929691356:web:4457a6d844a60917be0219", "measurementId": "G-FGRR0RGW4D"};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const { FieldValue } = firebase.firestore;

const state = {
  profile: null,
  feedMode: 'all',
  expandedComments: new Set(),
  viewed: new Set(JSON.parse(sessionStorage.getItem('viewedPosts') || '[]')),
  chats: [],
  unreadCount: 0,
};

function saveViewed() {
  sessionStorage.setItem('viewedPosts', JSON.stringify([...state.viewed]));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(s) {
  return String(s ?? '').replace(/\r/g, '').trim();
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  return 0;
}

function ago(v) {
  const t = toMs(v);
  if (!t) return 'только что';
  const d = Date.now() - t;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} дн назад`;
  return new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function icon(name, alt = '') {
  return `<img class="icon" src="images/${name}.svg" alt="${esc(alt)}">`;
}

function avatar(profile, size = 44, cls = '') {
  const name = profile?.nickname || profile?.displayName || 'U';
  const src = profile?.avatarData || profile?.avatarUrl || '';
  if (src) return `<img class="avatar ${cls}" style="width:${size}px;height:${size}px" src="${src}" alt="">`;
  return `<div class="avatar avatar-fallback ${cls}" style="width:${size}px;height:${size}px">${esc(name.slice(0,2).toUpperCase())}</div>`;
}

function tagsFromText(text) {
  const matches = clean(text).match(/#[\w\u0400-\u04FF]+/g) || [];
  return [...new Set(matches.map(t => t.slice(1).toLowerCase()))];
}

function tagChips(tags) {
  return tags.length ? `<div class="tag-row">${tags.map(t => `<a class="tag-chip" href="hashtags.html?tag=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : '';
}

function postScore(p) {
  return (Number(p.likeCount||0)*3) + (Number(p.commentCount||0)*4) + (Number(p.repostCount||0)*3) + Number(p.viewCount||0);
}

function sortPosts(list, mode) {
  const a = [...list];
  if (mode === 'popular') return a.sort((x,y) => postScore(y) - postScore(x));
  if (mode === 'likes') return a.sort((x,y) => (y.likeCount||0) - (x.likeCount||0));
  if (mode === 'comments') return a.sort((x,y) => (y.commentCount||0) - (x.commentCount||0));
  if (mode === 'reposts') return a.sort((x,y) => (y.repostCount||0) - (x.repostCount||0));
  if (mode === 'views') return a.sort((x,y) => (y.viewCount||0) - (x.viewCount||0));
  return a.sort((x,y) => toMs(y.createdAt) - toMs(x.createdAt));
}

function page() { return document.body.dataset.page || ''; }

function go(url) { location.href = url; }

function topbar(active='') {
  const unread = state.unreadCount;
  return `
  <div class="topbar">
    <a class="brand-link" href="feed.html">
      <div class="brand-mark">T</div>
      <div>
        <div class="brand-title">Talksy</div>
      </div>
    </a>
    <div class="top-icons">
      <a class="nav-icon ${active==='feed'?'active':''}" href="feed.html" title="Лента">${icon('home')}</a>
      <a class="nav-icon ${active==='hashtags'?'active':''}" href="hashtags.html" title="Хештеги">${icon('hashtags')}</a>
      <a class="nav-icon ${active==='messenger'?'active':''}" href="messenger.html" title="Сообщения">${icon('messages')}${unread?`<span class="badge" data-unread-badge>${unread}</span>`:''}</a>
      <a class="nav-icon ${active==='profile'?'active':''}" href="profile.html" title="Профиль">${icon('profile')}</a>
      <button class="nav-icon" id="logoutBtn" title="Выйти">${icon('logout')}</button>
    </div>
  </div>`;
}

async function waitAuth() {
  return new Promise(resolve => {
    const unsub = auth.onAuthStateChanged(u => { unsub(); resolve(u); });
  });
}

async function getProfile(uid) {
  if (!uid) return null;
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function ensureProfile(user) {
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      nickname: '',
      provider: user.providerData?.[0]?.providerId || 'password',
      avatarData: '',
      bio: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { uid: user.uid, nickname: '' };
  }
  return { id: snap.id, ...snap.data() };
}

async function saveProfile(uid, data) {
  await db.collection('users').doc(uid).set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

function chatId(a,b) {
  return [a,b].sort().join('__');
}

async function createChatWith(otherUid) {
  const me = auth.currentUser;
  if (!me || !otherUid) return null;
  const id = chatId(me.uid, otherUid);
  const ref = db.collection('chats').doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const myP = state.profile || await getProfile(me.uid);
    const otherP = await getProfile(otherUid);
    await ref.set({
      members: [me.uid, otherUid],
      names: {
        [me.uid]: myP?.nickname || me.email || 'Я',
        [otherUid]: otherP?.nickname || otherP?.displayName || 'Пользователь'
      },
      unread: { [me.uid]: 0, [otherUid]: 0 },
      lastMessage: '',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return id;
}

async function loadAllPosts() {
  const snap = await db.collection('posts').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function profileMapForPosts(posts) {
  const ids = [...new Set(posts.map(p => p.authorId).filter(Boolean))];
  const map = {};
  await Promise.all(ids.map(async uid => { const p = await getProfile(uid); if (p) map[uid] = p; }));
  return map;
}

function postCard(post, profiles = {}) {
  const author = profiles[post.authorId] || {};
  const name = author.nickname || author.displayName || post.authorName || 'Пользователь';
  const tags = tagChips(post.hashtags || []);
  const commentsOpen = state.expandedComments.has(post.id);
  return `
  <article class="post" data-post-id="${post.id}">
    <div class="post-head">
      <button class="author-link" data-open-profile="${post.authorId}" title="Открыть профиль">
        ${avatar(author, 42, 'avatar-sm')}
        <div class="author-meta">
          <div class="author-name">${esc(name)}</div>
          <div class="author-sub">${ago(post.createdAt)} · ${esc(post.category || 'общее')}</div>
        </div>
      </button>
      <span class="mini-pill">${esc(post.category || 'общее')}</span>
    </div>
    <div class="post-text">${esc(post.content || '').replace(/\n/g,'<br>')}</div>
    ${tags}
    <div class="post-stats">
      <span class="stat">${icon('like')} ${Number(post.likeCount||0)}</span>
      <span class="stat">${icon('messages')} ${Number(post.commentCount||0)}</span>
      <span class="stat">${icon('repost')} ${Number(post.repostCount||0)}</span>
      <span class="stat">${icon('view')} ${Number(post.viewCount||0)}</span>
    </div>
    <div class="post-actions">
      <button class="action-btn ${post.likedByMe?'active':''}" data-like="${post.id}" title="Лайк">${icon('like')}</button>
      <button class="action-btn ${commentsOpen?'active':''}" data-toggle-comments="${post.id}" title="Комментарии">${icon('messages')}</button>
      <button class="action-btn ${post.repostedByMe?'active':''}" data-repost="${post.id}" title="Репост">${icon('repost')}</button>
    </div>
    <div class="comments-box" data-comments-box="${post.id}" ${commentsOpen?'':'hidden'}></div>
  </article>`;
}

async function addViewOnce(postId) {
  if (!postId || state.viewed.has(postId)) return;
  state.viewed.add(postId);
  saveViewed();
  await db.collection('posts').doc(postId).set({ viewCount: FieldValue.increment(1) }, { merge: true });
}

async function loadComments(postId) {
  const snap = await db.collection('posts').doc(postId).collection('comments').get();
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  list.sort((a,b) => {
    const score = (Number(b.likeCount||0) - Number(a.likeCount||0));
    if (score !== 0) return score;
    return toMs(b.createdAt) - toMs(a.createdAt);
  });
  return list.slice(0, 5);
}

async function renderComments(postId, box) {
  const comments = await loadComments(postId);
  box.dataset.loaded = '1';
  box.innerHTML = `
    <div class="comments-head">
      <div>
        <div class="comments-title">Комментарии</div>
        <div class="small-note">Показаны 5 самых популярных</div>
      </div>
    </div>
    <div class="comments-list">
      ${comments.length ? comments.map(c => `
        <div class="comment-item">
          <div class="comment-top">
            <button class="comment-user" data-open-profile="${esc(c.authorId||'')}">
              ${avatar({nickname:c.authorName, avatarData:c.authorAvatar}, 28, 'avatar-xs')}
              <span>${esc(c.authorName || 'Пользователь')}</span>
            </button>
            <span class="comment-time">${ago(c.createdAt)}</span>
          </div>
          <div class="comment-text">${esc(c.text || '').replace(/\n/g,'<br>')}</div>
          <div class="comment-bottom">
            <button class="comment-like" data-comment-like="${postId}::${c.id}">${icon('like')} ${Number(c.likeCount||0)}</button>
          </div>
        </div>
      `).join('') : `<div class="empty-small">Комментариев пока нет.</div>`}
    </div>
    <form class="comment-form" data-comment-form="${postId}">
      <input class="input comment-input" name="text" maxlength="400" placeholder="Комментарий..." required>
      <button class="btn small-btn" type="submit">${icon('send')} Отправить</button>
    </form>`;
}

async function toggleLike(postId) {
  const uid = auth.currentUser.uid;
  const ref = db.collection('posts').doc(postId);
  const likeRef = ref.collection('likes').doc(uid);
  const snap = await likeRef.get();
  if (snap.exists) {
    await likeRef.delete();
    await ref.set({ likeCount: FieldValue.increment(-1) }, { merge: true });
  } else {
    await likeRef.set({ uid, createdAt: FieldValue.serverTimestamp() });
    await ref.set({ likeCount: FieldValue.increment(1) }, { merge: true });
  }
}

async function toggleRepost(postId) {
  const uid = auth.currentUser.uid;
  const postRef = db.collection('posts').doc(postId);
  const userRef = db.collection('users').doc(uid).collection('reposts').doc(postId);
  const snap = await userRef.get();
  if (snap.exists) {
    await userRef.delete();
    await postRef.set({ repostCount: FieldValue.increment(-1) }, { merge: true });
  } else {
    await userRef.set({ postId, createdAt: FieldValue.serverTimestamp() });
    await postRef.set({ repostCount: FieldValue.increment(1) }, { merge: true });
  }
}

async function toggleCommentLike(postId, commentId) {
  const uid = auth.currentUser.uid;
  const ref = db.collection('posts').doc(postId).collection('comments').doc(commentId);
  const likeRef = ref.collection('likes').doc(uid);
  const snap = await likeRef.get();
  if (snap.exists) {
    await likeRef.delete();
    await ref.set({ likeCount: FieldValue.increment(-1) }, { merge: true });
  } else {
    await likeRef.set({ uid, createdAt: FieldValue.serverTimestamp() });
    await ref.set({ likeCount: FieldValue.increment(1) }, { merge: true });
  }
}

async function addComment(postId, text) {
  const uid = auth.currentUser.uid;
  const profile = state.profile || await getProfile(uid);
  const cleanText = clean(text);
  if (!cleanText) return;
  await db.collection('posts').doc(postId).collection('comments').add({
    authorId: uid,
    authorName: profile?.nickname || profile?.displayName || auth.currentUser.email || 'Пользователь',
    authorAvatar: profile?.avatarData || '',
    text: cleanText,
    likeCount: 0,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('posts').doc(postId).set({ commentCount: FieldValue.increment(1) }, { merge: true });
}

async function loadUnread(uid) {
  const snap = await db.collection('chats').get();
  const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const unread = chats.filter(c => Array.isArray(c.members) && c.members.includes(uid) && Number((c.unread||{})[uid] || 0) > 0);
  state.unreadCount = unread.length;
  const badge = document.querySelector('[data-unread-badge]');
  if (badge) {
    badge.textContent = unread.length ? String(unread.length) : '';
    badge.style.display = unread.length ? '' : 'none';
  }
  const banner = document.querySelector('[data-message-banner]');
  if (banner) {
    if (unread.length) {
      const first = unread.sort((a,b)=>toMs(b.updatedAt)-toMs(a.updatedAt))[0];
      banner.hidden = false;
      banner.innerHTML = `<div><div class="banner-title">Вам написали</div><div class="banner-sub">${esc(first.lastMessage || 'Новое сообщение')}</div></div><a class="btn small-btn" href="messenger.html">${icon('messages')} Ответить</a>`;
    } else {
      banner.hidden = true;
      banner.innerHTML = '';
    }
  }
}

async function initFeed() {
  const user = await waitAuth();
  if (!user) return go('index.html');
  state.profile = await ensureProfile(user);
  if (!state.profile?.nickname) return go('register.html');
  document.body.insertAdjacentHTML('afterbegin', topbar('feed'));
  document.querySelector('#app').innerHTML = `
    <div class="layout">
      <section class="panel">
        <div class="panel-title">Новый пост</div>
        <div class="panel-sub">Репосты остаются только в профиле</div>
        <form id="postForm" class="stack" style="margin-top:12px">
          <textarea class="textarea" name="content" maxlength="2000" placeholder="Напиши что-то. Хештеги через #"></textarea>
          <div class="split">
            <select class="input" name="category">
              <option>общее</option><option>учёба</option><option>мемы</option><option>музыка</option><option>объявления</option>
            </select>
            <button class="btn" type="submit">${icon('plus')} Опубликовать</button>
          </div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-title">Лента</div>
        <div class="panel-sub" style="margin-top:4px">Все посты, лучшие, лайки, комменты, репосты, просмотры</div>
        <div class="mode-tabs" style="margin:14px 0">
          <button class="chip active" data-mode="all">все</button>
          <button class="chip" data-mode="popular">лучшие</button>
          <button class="chip" data-mode="likes">лайки</button>
          <button class="chip" data-mode="comments">комменты</button>
          <button class="chip" data-mode="reposts">репосты</button>
          <button class="chip" data-mode="views">просмотры</button>
        </div>
        <div class="message-banner" data-message-banner hidden></div>
        <div id="feedRoot" class="feed-root"></div>
      </section>
    </div>`;

  async function renderFeed() {
    const root = document.getElementById('feedRoot');
    const posts = await loadAllPosts();
    let list = sortPosts(posts, state.feedMode);
    const map = await profileMapForPosts(list);
    // mark liked and reposted by me
    await Promise.all(list.map(async p => {
      const likeSnap = await db.collection('posts').doc(p.id).collection('likes').doc(user.uid).get();
      const repostSnap = await db.collection('users').doc(user.uid).collection('reposts').doc(p.id).get();
      p.likedByMe = likeSnap.exists;
      p.repostedByMe = repostSnap.exists;
    }));
    if (!list.length) {
      root.innerHTML = `<div class="empty-state">Пока постов нет.</div>`;
      return;
    }
    root.innerHTML = list.map(p => postCard(p, map)).join('');
    list.forEach(p => addViewOnce(p.id));
  }

  document.body.addEventListener('click', async (e) => {
    if (e.target.closest('#logoutBtn')) {
      await auth.signOut(); go('index.html'); return;
    }
    const mode = e.target.closest('[data-mode]');
    if (mode) {
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
      mode.classList.add('active');
      state.feedMode = mode.dataset.mode;
      await renderFeed();
      return;
    }
    const likeBtn = e.target.closest('[data-like]');
    if (likeBtn) { await toggleLike(likeBtn.dataset.like); await renderFeed(); return; }
    const repostBtn = e.target.closest('[data-repost]');
    if (repostBtn) { await toggleRepost(repostBtn.dataset.repost); await renderFeed(); return; }
    const toggleComments = e.target.closest('[data-toggle-comments]');
    if (toggleComments) {
      const postId = toggleComments.dataset.toggleComments;
      const card = toggleComments.closest('.post');
      const box = card.querySelector(`[data-comments-box="${postId}"]`);
      const open = box.hidden;
      box.hidden = !open;
      state.expandedComments.add(postId);
      if (open && !box.dataset.loaded) await renderComments(postId, box);
      return;
    }
    const commentLike = e.target.closest('[data-comment-like]');
    if (commentLike) {
      const [postId, commentId] = commentLike.dataset.commentLike.split('::');
      await toggleCommentLike(postId, commentId);
      const box = commentLike.closest('.comments-box');
      box.dataset.loaded = '';
      await renderComments(postId, box);
      return;
    }
    const openProfile = e.target.closest('[data-open-profile]');
    if (openProfile) { go(`profile.html?uid=${encodeURIComponent(openProfile.dataset.openProfile)}`); return; }
  });

  document.body.addEventListener('submit', async (e) => {
    const form = e.target.closest('#postForm');
    if (form) {
      e.preventDefault();
      const content = clean(form.content.value);
      if (!content) return;
      const hashtags = tagsFromText(content);
      await db.collection('posts').add({
        authorId: user.uid,
        authorName: state.profile.nickname || user.email || 'Пользователь',
        authorAvatar: state.profile.avatarData || '',
        content,
        category: form.category.value || 'общее',
        hashtags,
        likeCount: 0,
        commentCount: 0,
        repostCount: 0,
        viewCount: 0,
        createdAt: FieldValue.serverTimestamp(),
      });
      form.reset();
      await renderFeed();
      return;
    }
    const commentForm = e.target.closest('[data-comment-form]');
    if (commentForm) {
      e.preventDefault();
      const postId = commentForm.dataset.commentForm;
      const text = commentForm.querySelector('input[name="text"]').value;
      await addComment(postId, text);
      await renderComments(postId, commentForm.closest('.comments-box'));
      await renderFeed();
    }
  });

  document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-mode="all"]').classList.add('active');
  await loadUnread(user.uid);
  await renderFeed();
  db.collection('chats').onSnapshot(() => loadUnread(user.uid));
}

async function initProfile() {
  const user = await waitAuth();
  if (!user) return go('index.html');
  state.profile = await ensureProfile(user);
  if (!state.profile?.nickname) return go('register.html');
  await loadUnread(user.uid);
  const targetUid = new URLSearchParams(location.search).get('uid') || user.uid;
  const target = await getProfile(targetUid);
  const own = targetUid === user.uid;
  document.body.insertAdjacentHTML('afterbegin', topbar('profile'));
  document.querySelector('#app').innerHTML = `
    <div class="layout profile-layout">
      <section class="panel profile-card">
        <div class="profile-top">
          ${avatar(target || { nickname: 'Пользователь' }, 92, 'avatar-lg')}
          <div>
            <div class="profile-name">${esc(target?.nickname || target?.displayName || 'Пользователь')}</div>
            <div class="brand-sub">${esc(target?.bio || 'Пока без описания')}</div>
            <div class="small-note">${esc(target?.email || '')}</div>
          </div>
        </div>
        <div class="profile-actions">
          ${own ? `<button class="btn" id="editToggle">${icon('edit')} Изменить</button>` : `<a class="btn" href="messenger.html?peer=${encodeURIComponent(targetUid)}">${icon('messages')} Написать</a>`}
        </div>
        <div id="editorBox" ${own ? 'hidden' : 'hidden'}>
          <div class="stack">
            <input class="input" id="nickInput" value="${esc(target?.nickname || '')}" placeholder="Ник">
            <textarea class="textarea small-textarea" id="bioInput" placeholder="Описание">${esc(target?.bio || '')}</textarea>
            <div class="avatar-maker">
              <div class="maker-head">
                <div>
                  <div class="panel-title">Рисунок-аватар</div>
                  <div class="panel-sub">рисуй как в пейнте</div>
                </div>
                <div class="maker-tools">
                  <input id="brushColor" type="color" value="#1d5bd7">
                  <input id="brushSize" type="range" min="2" max="32" value="8">
                  <button class="chip" type="button" id="clearCanvas">очистить</button>
                </div>
              </div>
              <canvas id="avatarCanvas" width="320" height="320"></canvas>
              <button class="btn" id="saveProfileBtn">${icon('save')} Сохранить</button>
            </div>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-title">Посты и репосты</div>
        <div class="panel-sub" style="margin-top:4px">репосты здесь, не в ленте</div>
        <div class="mode-tabs" style="margin:14px 0">
          <button class="chip active" data-tab="posts">посты</button>
          <button class="chip" data-tab="reposts">репосты</button>
        </div>
        <div id="profileRoot" class="feed-root"></div>
      </section>
    </div>`;

  // painter
  const canvas = document.getElementById('avatarCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if (target?.avatarData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img,0,0,canvas.width,canvas.height);
      img.src = target.avatarData;
    }
    let drawing = false;
    const color = document.getElementById('brushColor');
    const size = document.getElementById('brushSize');
    const pos = ev => {
      const rect = canvas.getBoundingClientRect();
      const p = ev.touches ? ev.touches[0] : ev;
      return {
        x: (p.clientX - rect.left) * canvas.width / rect.width,
        y: (p.clientY - rect.top) * canvas.height / rect.height
      };
    };
    const draw = ev => {
      if (!drawing) return;
      ev.preventDefault();
      const p = pos(ev);
      ctx.lineWidth = Number(size.value);
      ctx.lineCap = 'round';
      ctx.strokeStyle = color.value;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    canvas.addEventListener('mousedown', ev => { drawing = true; const p = pos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', () => { drawing = false; ctx.beginPath(); });
    canvas.addEventListener('touchstart', ev => { drawing = true; const p = pos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive:false });
    canvas.addEventListener('touchmove', draw, { passive:false });
    canvas.addEventListener('touchend', () => { drawing = false; ctx.beginPath(); });
    document.getElementById('clearCanvas').onclick = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
    };
  }

  let tab = 'posts';
  async function renderProfileList() {
    const all = await loadAllPosts();
    let list;
    if (tab === 'posts') {
      list = all.filter(p => p.authorId === targetUid);
    } else {
      const reps = await db.collection('users').doc(targetUid).collection('reposts').get();
      const ids = reps.docs.map(d => d.id);
      list = all.filter(p => ids.includes(p.id));
    }
    list = sortPosts(list, 'all');
    const map = await profileMapForPosts(list);
    await Promise.all(list.map(async p => {
      const likeSnap = await db.collection('posts').doc(p.id).collection('likes').doc(user.uid).get();
      const repostSnap = await db.collection('users').doc(user.uid).collection('reposts').doc(p.id).get();
      p.likedByMe = likeSnap.exists;
      p.repostedByMe = repostSnap.exists;
    }));
    const root = document.getElementById('profileRoot');
    root.innerHTML = list.length ? list.map(p => postCard(p, map)).join('') : `<div class="empty-state">Пока ничего нет.</div>`;
    list.forEach(p => addViewOnce(p.id));
  }

  document.body.addEventListener('click', async (e) => {
    if (e.target.closest('#logoutBtn')) { await auth.signOut(); go('index.html'); return; }
    if (e.target.closest('#editToggle')) {
      const box = document.getElementById('editorBox');
      box.hidden = !box.hidden;
      return;
    }
    if (e.target.closest('#saveProfileBtn')) {
      const nick = clean(document.getElementById('nickInput').value);
      const bio = clean(document.getElementById('bioInput').value);
      if (!nick) return alert('Нужен ник.');
      const avatarData = document.getElementById('avatarCanvas').toDataURL('image/png');
      await saveProfile(user.uid, {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        nickname: nick,
        bio,
        avatarData,
      });
      location.reload();
      return;
    }
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      tabBtn.classList.add('active');
      tab = tabBtn.dataset.tab;
      await renderProfileList();
      return;
    }
    const likeBtn = e.target.closest('[data-like]');
    if (likeBtn) { await toggleLike(likeBtn.dataset.like); await renderProfileList(); return; }
    const repostBtn = e.target.closest('[data-repost]');
    if (repostBtn) { await toggleRepost(repostBtn.dataset.repost); await renderProfileList(); return; }
    const commentsBtn = e.target.closest('[data-toggle-comments]');
    if (commentsBtn) {
      const postId = commentsBtn.dataset.toggleComments;
      const card = commentsBtn.closest('.post');
      const box = card.querySelector(`[data-comments-box="${postId}"]`);
      const open = box.hidden;
      box.hidden = !open;
      state.expandedComments.add(postId);
      if (open && !box.dataset.loaded) await renderComments(postId, box);
      return;
    }
    const commentLike = e.target.closest('[data-comment-like]');
    if (commentLike) {
      const [postId, commentId] = commentLike.dataset.commentLike.split('::');
      await toggleCommentLike(postId, commentId);
      const box = commentLike.closest('.comments-box');
      box.dataset.loaded = '';
      await renderComments(postId, box);
      return;
    }
    const openProfile = e.target.closest('[data-open-profile]');
    if (openProfile) { go(`profile.html?uid=${encodeURIComponent(openProfile.dataset.openProfile)}`); return; }
  });

  document.body.addEventListener('submit', async (e) => {
    const commentForm = e.target.closest('[data-comment-form]');
    if (commentForm) {
      e.preventDefault();
      const postId = commentForm.dataset.commentForm;
      const text = commentForm.querySelector('input[name="text"]').value;
      await addComment(postId, text);
      await renderComments(postId, commentForm.closest('.comments-box'));
      await renderProfileList();
    }
  });

  await renderProfileList();
}

async function initMessenger() {
  const user = await waitAuth();
  if (!user) return go('index.html');
  state.profile = await ensureProfile(user);
  if (!state.profile?.nickname) return go('register.html');
  await loadUnread(user.uid);
  document.body.insertAdjacentHTML('afterbegin', topbar('messenger'));
  document.querySelector('#app').innerHTML = `
    <div class="layout messenger-layout">
      <section class="panel">
        <div class="panel-title">Сообщения</div>
        <div class="chat-list" id="chatList"></div>
      </section>
      <section class="panel chat-panel">
        <div class="chat-header" id="chatHeader"></div>
        <div class="chat-messages" id="chatMessages"></div>
        <form class="chat-form" id="chatForm">
          <input class="input" id="chatInput" maxlength="1000" placeholder="Написать сообщение...">
          <button class="btn" type="submit">${icon('send')} Отправить</button>
        </form>
      </section>
    </div>`;
  let chats = [];

  async function loadChats() {
    const snap = await db.collection('chats').get();
    chats = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => Array.isArray(c.members) && c.members.includes(user.uid))
      .sort((a,b)=>toMs(b.updatedAt)-toMs(a.updatedAt));
    state.unreadCount = chats.filter(c => Number((c.unread||{})[user.uid] || 0) > 0).length;
    renderChatList();
    const banner = document.querySelector('[data-message-banner]');
    if (banner) banner.hidden = true;
  }

  function renderChatList() {
    const list = document.getElementById('chatList');
    if (!chats.length) { list.innerHTML = `<div class="empty-state">Пока чатов нет.</div>`; return; }
    list.innerHTML = chats.map(chat => {
      const other = (chat.members || []).find(id => id !== user.uid);
      const title = chat.names?.[other] || 'Чат';
      const unread = Number((chat.unread || {})[user.uid] || 0);
      return `<button class="chat-item ${state.selectedChatId===chat.id?'active':''}" data-chat-open="${chat.id}">
        <div class="chat-title">${esc(title)}</div>
        <div class="chat-preview">${esc(chat.lastMessage || 'Пусто')}</div>
        ${unread ? `<span class="chat-badge">${unread}</span>` : ''}
      </button>`;
    }).join('');
  }

  async function openChat(chatId) {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    state.selectedChatId = chatId;
    const other = (chat.members || []).find(id => id !== user.uid);
    const otherProfile = await getProfile(other);
    document.getElementById('chatHeader').innerHTML = `
      <div class="chat-header-left">
        ${avatar(otherProfile || {nickname: chat.names?.[other] || 'Пользователь'}, 44, 'avatar-sm')}
        <div>
          <div class="panel-title">${esc(chat.names?.[other] || otherProfile?.nickname || 'Чат')}</div>
          <div class="panel-sub">прямой диалог</div>
        </div>
      </div>
      <a class="chip" href="profile.html?uid=${encodeURIComponent(other)}">Профиль</a>`;
    const snap = await db.collection('chats').doc(chatId).collection('messages').get();
    const messages = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>toMs(a.createdAt)-toMs(b.createdAt));
    document.getElementById('chatMessages').innerHTML = messages.length ? messages.map(m => `
      <div class="msg ${m.senderId===user.uid?'mine':''}">
        <div class="msg-text">${esc(m.text).replace(/\n/g,'<br>')}</div>
        <div class="msg-time">${ago(m.createdAt)}</div>
      </div>`).join('') : `<div class="empty-state">Напиши первым.</div>`;
    document.getElementById('chatMessages').scrollTop = 999999;
    await db.collection('chats').doc(chatId).set({ [`unread.${user.uid}`]: 0 }, { merge:true });
    await loadChats();
  }

  document.body.addEventListener('click', async (e) => {
    if (e.target.closest('#logoutBtn')) { await auth.signOut(); go('index.html'); return; }
    const open = e.target.closest('[data-chat-open]');
    if (open) { await openChat(open.dataset.chatOpen); return; }
    const openProfile = e.target.closest('[data-open-profile]');
    if (openProfile) { go(`profile.html?uid=${encodeURIComponent(openProfile.dataset.openProfile)}`); return; }
  });

  document.body.addEventListener('submit', async (e) => {
    if (e.target.id !== 'chatForm') return;
    e.preventDefault();
    const text = clean(document.getElementById('chatInput').value);
    if (!text || !state.selectedChatId) return;
    const chatRef = db.collection('chats').doc(state.selectedChatId);
    const snap = await chatRef.get();
    if (!snap.exists) return;
    const chat = snap.data();
    const other = (chat.members || []).find(id => id !== user.uid);
    await chatRef.collection('messages').add({
      senderId: user.uid,
      text,
      createdAt: FieldValue.serverTimestamp(),
    });
    await chatRef.set({
      lastMessage: text,
      updatedAt: FieldValue.serverTimestamp(),
      [`unread.${other}`]: FieldValue.increment(1),
      [`unread.${user.uid}`]: 0,
    }, { merge:true });
    document.getElementById('chatInput').value = '';
    await openChat(state.selectedChatId);
    await loadChats();
  });

  await loadChats();
  const params = new URLSearchParams(location.search);
  const peer = params.get('peer');
  const chat = params.get('chat');
  if (peer) {
    const id = await createChatWith(peer);
    await loadChats();
    await openChat(id);
  } else if (chat) {
    await openChat(chat);
  } else if (chats[0]) {
    await openChat(chats[0].id);
  }
  db.collection('chats').onSnapshot(() => loadChats());
}

async function initHashtags() {
  const user = await waitAuth();
  if (!user) return go('index.html');
  state.profile = await ensureProfile(user);
  if (!state.profile?.nickname) return go('register.html');
  await loadUnread(user.uid);
  document.body.insertAdjacentHTML('afterbegin', topbar('hashtags'));
  document.querySelector('#app').innerHTML = `
    <div class="layout hashtags-layout">
      <section class="panel">
        <div class="panel-title">Хештеги</div>
        <div class="panel-sub">Популярные и все теги</div>
        <div style="margin-top:12px">
          <input class="input" id="tagSearch" placeholder="Поиск без #">
        </div>
        <div class="tag-block">
          <div class="panel-sub">Популярные</div>
          <div id="popularTags" class="tag-cloud"></div>
        </div>
        <div class="tag-block">
          <div class="panel-sub">Все теги</div>
          <div id="allTags" class="tag-cloud"></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-title">Посты по тегу</div>
        <div class="panel-sub" id="tagLabel">все теги</div>
        <div id="tagRoot" class="feed-root" style="margin-top:14px"></div>
      </section>
    </div>`;

  const posts = await loadAllPosts();
  const counts = {};
  posts.forEach(p => (p.hashtags || []).forEach(t => counts[t] = (counts[t] || 0) + 1));
  const tags = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  let selected = new URLSearchParams(location.search).get('tag') || '';

  function renderTagButtons() {
    const q = clean(document.getElementById('tagSearch').value).toLowerCase();
    const make = ([tag,count]) => `<button class="tag-chip tag-btn" data-tag="${esc(tag)}" ${q && !tag.includes(q) ? 'hidden' : ''}>#${esc(tag)} <span>${count}</span></button>`;
    document.getElementById('popularTags').innerHTML = tags.slice(0,10).map(make).join('') || `<div class="empty-small">Тегов пока нет.</div>`;
    document.getElementById('allTags').innerHTML = tags.map(make).join('') || `<div class="empty-small">Тегов пока нет.</div>`;
  }

  async function renderTagPosts() {
    document.getElementById('tagLabel').textContent = selected ? `#${selected}` : 'все теги';
    let list = selected ? posts.filter(p => (p.hashtags || []).map(t=>t.toLowerCase()).includes(selected.toLowerCase())) : sortPosts(posts, 'popular');
    const map = await profileMapForPosts(list);
    await Promise.all(list.map(async p => {
      const likeSnap = await db.collection('posts').doc(p.id).collection('likes').doc(user.uid).get();
      const repostSnap = await db.collection('users').doc(user.uid).collection('reposts').doc(p.id).get();
      p.likedByMe = likeSnap.exists;
      p.repostedByMe = repostSnap.exists;
    }));
    document.getElementById('tagRoot').innerHTML = list.length ? list.map(p => postCard(p, map)).join('') : `<div class="empty-state">Нет постов с таким тегом.</div>`;
    list.forEach(p => addViewOnce(p.id));
  }

  document.getElementById('tagSearch').addEventListener('input', renderTagButtons);

  document.body.addEventListener('click', async (e) => {
    if (e.target.closest('#logoutBtn')) { await auth.signOut(); go('index.html'); return; }
    const btn = e.target.closest('[data-tag]');
    if (btn && btn.classList.contains('tag-btn')) {
      selected = btn.dataset.tag;
      await renderTagPosts();
      return;
    }
    const likeBtn = e.target.closest('[data-like]');
    if (likeBtn) { await toggleLike(likeBtn.dataset.like); await renderTagPosts(); return; }
    const repostBtn = e.target.closest('[data-repost]');
    if (repostBtn) { await toggleRepost(repostBtn.dataset.repost); await renderTagPosts(); return; }
    const commentsBtn = e.target.closest('[data-toggle-comments]');
    if (commentsBtn) {
      const postId = commentsBtn.dataset.toggleComments;
      const card = commentsBtn.closest('.post');
      const box = card.querySelector(`[data-comments-box="${postId}"]`);
      const open = box.hidden;
      box.hidden = !open;
      state.expandedComments.add(postId);
      if (open && !box.dataset.loaded) await renderComments(postId, box);
      return;
    }
    const commentLike = e.target.closest('[data-comment-like]');
    if (commentLike) {
      const [postId, commentId] = commentLike.dataset.commentLike.split('::');
      await toggleCommentLike(postId, commentId);
      const box = commentLike.closest('.comments-box');
      box.dataset.loaded = '';
      await renderComments(postId, box);
      return;
    }
    const openProfile = e.target.closest('[data-open-profile]');
    if (openProfile) { go(`profile.html?uid=${encodeURIComponent(openProfile.dataset.openProfile)}`); return; }
  });

  document.body.addEventListener('submit', async (e) => {
    const commentForm = e.target.closest('[data-comment-form]');
    if (commentForm) {
      e.preventDefault();
      const postId = commentForm.dataset.commentForm;
      const text = commentForm.querySelector('input[name="text"]').value;
      await addComment(postId, text);
      await renderComments(postId, commentForm.closest('.comments-box'));
      await renderTagPosts();
    }
  });

  renderTagButtons();
  await renderTagPosts();
}

async function initAuth() {
  document.querySelector('#app').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark big">S</div>
          <div>
            <div class="brand-title">Форум школы</div>
            <div class="brand-sub">вход</div>
          </div>
        </div>
        <form id="loginForm" class="stack">
          <input class="input" name="email" type="email" placeholder="Почта" required>
          <input class="input" name="password" type="password" placeholder="Пароль" required>
          <button class="btn" type="submit">${icon('messages')} Войти</button>
        </form>
        <div class="divider">или</div>
        <button class="chip big-chip" id="googleLogin">${icon('profile')} Войти через Google</button>
        <a class="chip big-chip" href="register.html">Регистрация</a>
      </div>
    </div>`;
  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    await auth.signInWithEmailAndPassword(e.target.email.value.trim(), e.target.password.value);
    const profile = await getProfile(auth.currentUser.uid);
    if (!profile?.nickname) go('register.html');
    else go('feed.html');
  });
  document.getElementById('googleLogin').addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
    const profile = await getProfile(auth.currentUser.uid);
    if (!profile?.nickname) go('register.html');
    else go('feed.html');
  });
}

async function initRegister() {
  const current = await waitAuth();
  document.querySelector('#app').innerHTML = current ? `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark big">S</div>
          <div>
            <div class="brand-title">Дополни профиль</div>
            <div class="brand-sub">нужен только ник</div>
          </div>
        </div>
        <div class="helper">Ты уже вошёл как <b>${esc(current.email || current.displayName || 'пользователь')}</b>.</div>
        <form id="nickForm" class="stack">
          <input class="input" name="nickname" type="text" maxlength="24" placeholder="Ник" required>
          <button class="btn" type="submit">${icon('save')} Сохранить ник</button>
        </form>
        <a class="chip big-chip" href="feed.html">В форум</a>
      </div>
    </div>` : `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark big">S</div>
          <div>
            <div class="brand-title">Регистрация</div>
            <div class="brand-sub">почта, пароль и ник</div>
          </div>
        </div>
        <form id="regForm" class="stack">
          <input class="input" name="email" type="email" placeholder="Почта" required>
          <input class="input" name="password" type="password" placeholder="Пароль" required>
          <input class="input" name="nickname" type="text" maxlength="24" placeholder="Ник" required>
          <button class="btn" type="submit">${icon('plus')} Создать аккаунт</button>
        </form>
        <div class="divider">или</div>
        <button class="chip big-chip" id="googleReg">${icon('profile')} Google + ник</button>
        <a class="chip big-chip" href="index.html">Назад</a>
      </div>
    </div>`;

  const nickForm = document.getElementById('nickForm');
  if (nickForm) {
    nickForm.addEventListener('submit', async e => {
      e.preventDefault();
      const nickname = clean(e.target.nickname.value);
      if (!nickname) return;
      await saveProfile(current.uid, {
        uid: current.uid,
        email: current.email || '',
        displayName: current.displayName || '',
        nickname,
        provider: current.providerData?.[0]?.providerId || 'google',
        avatarData: '',
        bio: '',
      });
      go('feed.html');
    });
    return;
  }

  document.getElementById('regForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const password = e.target.password.value;
    const nickname = clean(e.target.nickname.value);
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await saveProfile(cred.user.uid, {
      uid: cred.user.uid,
      email,
      displayName: cred.user.displayName || '',
      nickname,
      provider: 'password',
      avatarData: '',
      bio: '',
    });
    go('feed.html');
  });
  document.getElementById('googleReg').addEventListener('click', async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
    const profile = await getProfile(auth.currentUser.uid);
    if (profile?.nickname) return go('feed.html');
    const nickname = prompt('Придумай ник для форума:')?.trim();
    if (!nickname) return;
    await saveProfile(auth.currentUser.uid, {
      uid: auth.currentUser.uid,
      email: auth.currentUser.email || '',
      displayName: auth.currentUser.displayName || '',
      nickname,
      provider: 'google',
      avatarData: '',
      bio: '',
    });
    go('feed.html');
  });
}

async function boot() {
  const current = await waitAuth();
  const p = page();
  state.currentUser = current;
  if ((p === 'feed' || p === 'profile' || p === 'messenger' || p === 'hashtags') && !current) {
    go('index.html');
    return;
  }
  if (current && (p === 'feed' || p === 'profile' || p === 'messenger' || p === 'hashtags')) {
    state.profile = await ensureProfile(current);
    if (!state.profile?.nickname && p !== 'profile') {
      go('register.html');
      return;
    }
  }
  if (p === 'auth') {
    if (current) {
      const profile = await getProfile(current.uid);
      if (profile?.nickname) return go('feed.html');
    }
    await initAuth();
  }
  if (p === 'register') await initRegister();
  if (p === 'feed') await initFeed();
  if (p === 'profile') await initProfile();
  if (p === 'messenger') await initMessenger();
  if (p === 'hashtags') await initHashtags();
}

boot().catch(err => {
  console.error(err);
  const root = document.querySelector('#app') || document.body;
  root.innerHTML = `<div class="panel"><div class="panel-title">Ошибка</div><div class="small-note">${esc(err?.message || err)}</div></div>`;
});
