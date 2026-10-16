const $ = (s) => document.querySelector(s);
const authScreen = $("#auth-screen"), app = $("#app"), sidebar = $("#sidebar");
const welcome = $("#welcome"), chatArea = $("#chat-area"), messagesEl = $("#messages");
const input = $("#message-input"), sendBtn = $("#send-btn"), convList = $("#conversation-list");
let user = null, conversations = [], activeId = null, busy = false, firebaseAuth = null;
const STORAGE_KEY = "nexus-ai-conversations-v1";
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),3000)}
function loadConversations(){try{conversations=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{conversations=[]}renderConversationList()}
function persist(){localStorage.setItem(STORAGE_KEY,JSON.stringify(conversations))}
function activeConversation(){return conversations.find(c=>c.id===activeId)}
function ensureConversation(firstText="New conversation"){if(!activeConversation()){const c={id:uid(),title:firstText.slice(0,42)||"New conversation",messages:[],updated:Date.now()};conversations.unshift(c);activeId=c.id;persist();renderConversationList()}return activeConversation()}
function renderConversationList(){convList.innerHTML="";const sorted=[...conversations].sort((a,b)=>b.updated-a.updated);if(!sorted.length){convList.innerHTML='<div style="padding:10px 8px;color:#625e70;font-size:10px;line-height:1.7">Your conversations will appear here.</div>';return}
 for(const c of sorted){const row=document.createElement("div");row.className="conversation-item"+(c.id===activeId?" selected":"");row.innerHTML=`<span>◌</span><span class="conv-title">${escapeHtml(c.title||"New conversation")}</span><button class="conv-delete" title="Delete conversation" aria-label="Delete conversation">×</button>`;row.addEventListener("click",e=>{if(e.target.closest(".conv-delete")){e.stopPropagation();deleteConversation(c.id);return}openConversation(c.id)});convList.appendChild(row)}}
function deleteConversation(id){conversations=conversations.filter(c=>c.id!==id);if(activeId===id){activeId=null;showWelcome()}persist();renderConversationList()}
function showWelcome(){welcome.classList.remove("hidden");chatArea.classList.add("hidden");messagesEl.innerHTML="";activeId=null;renderConversationList()}
function openConversation(id){activeId=id;const c=activeConversation();if(!c)return;welcome.classList.add("hidden");chatArea.classList.remove("hidden");messagesEl.innerHTML="";c.messages.forEach(m=>renderMessage(m.role,m.content,false));renderConversationList();scrollChat();closeSidebar()}
function startNewChat(){showWelcome();input.value="";updateCount();input.focus();closeSidebar()}
function renderMessage(role,content,addActions=true){const row=document.createElement("article");row.className="message "+(role==="user"?"user":"assistant");const avatar=role==="user"?(user?.displayName?.[0]||"Z"):"✳";row.innerHTML=`<div class="message-avatar">${escapeHtml(avatar)}</div><div class="message-content">${formatContent(content)}</div>`;if(role==="assistant"&&addActions){const actions=document.createElement("div");actions.className="message-actions";actions.innerHTML='<button data-copy>▢ Copy response</button>';actions.querySelector("[data-copy]").onclick=async()=>{try{await navigator.clipboard.writeText(content);toast("Copied to clipboard")}catch{toast("Clipboard unavailable in this browser")}};row.querySelector(".message-content").appendChild(actions)}messagesEl.appendChild(row);return row}
function formatContent(text){const escaped=escapeHtml(text);return escaped.split(/```/).map((part,i)=>i%2?`<pre><code>${part.replace(/^\w+\n/,"")}</code></pre>`:part.split(/\n{2,}/).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("")).join("")}
function scrollChat(){chatArea.scrollTop=chatArea.scrollHeight}
function updateCount(){ $("#input-count").textContent=`${input.value.length} / 4000`;sendBtn.disabled=busy||!input.value.trim()}
function closeSidebar(){sidebar.classList.remove("open");$("#overlay").classList.remove("show")}
function openSidebar(){sidebar.classList.add("open");$("#overlay").classList.add("show")}
function setUser(u){user=u;$("#user-name").textContent=u?.displayName||"Guest explorer";$("#user-email").textContent=u?.email||"Saved on this device";$("#user-avatar").textContent=(u?.displayName||"Z").slice(0,1).toUpperCase();authScreen.classList.add("hidden");app.classList.remove("hidden");loadConversations()}
function signOut(){
 if(!user || user.email==="Saved on this device"){
   user=null;app.classList.add("hidden");authScreen.classList.remove("hidden");closeSidebar();return;
 }
 if(firebaseAuth){
   import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js")
     .then(m=>m.signOut(firebaseAuth)).catch(()=>{});
 } else {
   user=null;app.classList.add("hidden");authScreen.classList.remove("hidden");closeSidebar();
 }
}
async function setupFirebase(){
 try{
  const r=await fetch("/api/config"),cfg=await r.json(),f=cfg.firebase||{};
  if(!f.apiKey||!f.authDomain||!f.projectId||!f.appId){
   $("#auth-note").textContent="Google sign-in needs Firebase setup. Guest mode is ready to use.";
   return;
  }
  const appMod=await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const authMod=await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const fb=appMod.getApps().length?appMod.getApp():appMod.initializeApp(f);
  firebaseAuth=authMod.getAuth(fb);
  await authMod.setPersistence(firebaseAuth,authMod.browserLocalPersistence);
  const provider=()=>{const p=new authMod.GoogleAuthProvider();p.setCustomParameters({prompt:"select_account"});return p};
  $("#google-login").onclick=async()=>{
   try{const result=await authMod.signInWithPopup(firebaseAuth,provider());rememberAccount(result.user);setUser(result.user)}
   catch(e){toast(e.message||"Google sign-in failed")}
  };
  $("#switch-account").onclick=async()=>{
   if(!firebaseAuth){toast("Google sign-in isn't configured yet.");return}
   try{
    const result=await authMod.signInWithPopup(firebaseAuth,provider());
    rememberAccount(result.user);setUser(result.user);toast("Google account switched");
   }catch(e){if(e.code!=="auth/popup-closed-by-user")toast(e.message||"Couldn't switch account")}
  };
  authMod.onAuthStateChanged(firebaseAuth,(u)=>{
   if(u){rememberAccount(u);setUser(u)}
   else if(user && user.email!=="Saved on this device"){
    user=null;app.classList.add("hidden");authScreen.classList.remove("hidden");closeSidebar();
   }
  });
  $("#auth-note").textContent="Sign in with Google. Nexus AI will remember your login on this device.";
 }catch(e){$("#auth-note").textContent="Could not load sign-in settings. Guest mode is available."}
}
function rememberAccount(u){
 try{
  const key="nexus-ai-google-accounts-v1";
  let list=JSON.parse(localStorage.getItem(key)||"[]");
  list=list.filter(a=>a.email!==u.email);
  list.unshift({email:u.email||"",displayName:u.displayName||"Google user",photoURL:u.photoURL||""});
  localStorage.setItem(key,JSON.stringify(list.slice(0,2)));
 }catch{}
}
async function sendMessage(text){if(busy)return;text=text.trim();if(!text)return;if(text.length>4000){toast("Please keep messages under 4,000 characters.");return}
 const c=ensureConversation(text);if(!c.messages.length)c.title=text.length>42?text.slice(0,39)+"…":text;c.messages.push({role:"user",content:text});c.updated=Date.now();persist();welcome.classList.add("hidden");chatArea.classList.remove("hidden");renderMessage("user",text);input.value="";resizeInput();updateCount();renderConversationList();
 const typing=document.createElement("article");typing.className="message";typing.innerHTML='<div class="message-avatar">✳</div><div class="message-content"><div class="typing"><i></i><i></i><i></i></div></div>';messagesEl.appendChild(typing);busy=true;updateCount();scrollChat();
 try{const response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:[{role:"system",content:"You are Nexus AI, a helpful, thoughtful, accurate assistant. Use clear structure and concise explanations. Format code in fenced code blocks."},...c.messages.map(m=>({role:m.role,content:m.content}))]})});const data=await response.json();typing.remove();if(!response.ok)throw new Error(data.error||"The AI request failed.");c.messages.push({role:"assistant",content:data.answer});c.updated=Date.now();persist();renderMessage("assistant",data.answer);renderConversationList()}
 catch(e){typing.remove();const err=`I couldn't get a response. ${e.message}`;renderMessage("assistant",err);toast("AI connection issue")}
 finally{busy=false;updateCount();scrollChat()}}
function resizeInput(){input.style.height="auto";input.style.height=Math.min(input.scrollHeight,180)+"px"}
$("#guest-login").addEventListener("click",()=>setUser({displayName:"Guest explorer",email:"Saved on this device"}));

$("#new-chat").addEventListener("click",startNewChat);$("#close-sidebar").addEventListener("click",closeSidebar);$("#open-sidebar").addEventListener("click",openSidebar);$("#overlay").addEventListener("click",closeSidebar);
$("#send-btn").addEventListener("click",()=>sendMessage(input.value));
input.addEventListener("input",()=>{resizeInput();updateCount()});input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(input.value)}});
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>{input.value=b.dataset.prompt;updateCount();sendMessage(input.value)}));
$("#clear-history").addEventListener("click",()=>{if(!conversations.length){toast("No conversations to clear");return}if(confirm("Delete all saved conversations on this device?")){conversations=[];activeId=null;persist();renderConversationList();showWelcome();toast("Conversation history cleared")}});
$("#logout").addEventListener("click",signOut);
$("#footer-year").textContent=new Date().getFullYear();$("#theme-toggle").addEventListener("click",()=>{document.body.classList.toggle("light");localStorage.setItem("nexus-ai-theme",document.body.classList.contains("light")?"light":"dark")});
$("#attach-btn").addEventListener("click",()=>toast("File uploads are not enabled in this starter."));
$("#nav-chat").addEventListener("click",startNewChat);$("#nav-explore").addEventListener("click",()=>{startNewChat();toast("Choose a prompt card to get started.")});
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();startNewChat()}if(e.key==="Escape")closeSidebar()});
if(localStorage.getItem("nexus-ai-theme")==="light")document.body.classList.add("light");
setupFirebase();updateCount();
