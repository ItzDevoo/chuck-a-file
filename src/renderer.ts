// Define the shape of our API
export interface IElectronAPI {
  selectFile: () => Promise<string | undefined>;
  selectFolder: () => Promise<string | undefined>;
  apiCall: (endpoint: string, options?: any) => Promise<any>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

// Tell TypeScript that the global window object has our new property
declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}

// State Management
interface AppState {
  isAuthenticated: boolean;
  user: any;
  token: string | null;
  currentView: 'home' | 'chat';
  currentFriend: any;
  friends: any[];
}

let appState: AppState = {
  isAuthenticated: false,
  user: null,
  token: null,
  currentView: 'home',
  currentFriend: null,
  friends: []
};

// API Helper Functions using Electron's secure API
async function apiCall(endpoint: string, options: any = {}) {
  return await window.electronAPI.apiCall(endpoint, options);
}

// Authentication Functions
async function login(username: string, password: string) {
  try {
    const data = await apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (data.success) {
      window.electronAPI.setItem('auth_token', data.token);
      appState.isAuthenticated = true;
      appState.user = data.user;
      appState.token = data.token;
      
      showMainApp();
      loadFriends();
    }
    
    return data;
  } catch (error) {
    throw error;
  }
}

async function register(username: string, password: string) {
  try {
    const data = await apiCall('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (data.success) {
      window.electronAPI.setItem('auth_token', data.token);
      appState.isAuthenticated = true;
      appState.user = data.user;
      appState.token = data.token;
      
      showMainApp();
      loadFriends();
    }
    
    return data;
  } catch (error) {
    throw error;
  }
}

async function verifyToken() {
  try {
    const data = await apiCall('/auth/verify');
    
    if (data.success) {
      appState.isAuthenticated = true;
      appState.user = data.user;
      appState.token = window.electronAPI.getItem('auth_token');
      
      showMainApp();
      loadFriends();
      return true;
    }
  } catch (error) {
    window.electronAPI.removeItem('auth_token');
    return false;
  }
  
  return false;
}

function logout() {
  window.electronAPI.removeItem('auth_token');
  appState.isAuthenticated = false;
  appState.user = null;
  appState.token = null;
  appState.friends = [];
  
  showAuthScreen();
}

// UI Management Functions
function showAuthScreen() {
  document.getElementById('auth-screen')?.classList.add('active');
  document.getElementById('app-screen')?.classList.remove('active');
}

function showMainApp() {
  document.getElementById('auth-screen')?.classList.remove('active');
  document.getElementById('app-screen')?.classList.add('active');
  
  updateUserInfo();
}

function updateUserInfo() {
  if (!appState.user) return;
  
  const usernameEl = document.getElementById('current-username');
  const friendCodeEl = document.getElementById('current-friend-code');
  
  if (usernameEl) usernameEl.textContent = appState.user.username;
  if (friendCodeEl) friendCodeEl.textContent = `Friend Code: ${appState.user.friendCode}`;
}

function showView(viewName: 'home' | 'chat') {
  // Remove active class from all views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  
  // Remove active class from all sidebar buttons
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show the requested view
  document.getElementById(`${viewName}-view`)?.classList.add('active');
  
  // Update sidebar button
  if (viewName === 'home') {
    document.getElementById('home-btn')?.classList.add('active');
  }
  
  appState.currentView = viewName;
}

// Friends Management
async function loadFriends() {
  try {
    const data = await apiCall('/users/friends');
    
    if (data.success) {
      appState.friends = data.friends;
      updateFriendsUI();
    }
  } catch (error) {
    console.error('Failed to load friends:', error);
  }
}

function updateFriendsUI() {
  const friendsList = document.getElementById('friends-list');
  if (!friendsList) return;
  
  friendsList.innerHTML = '';
  
  appState.friends.forEach(friend => {
    const friendEl = document.createElement('div');
    friendEl.className = 'friend-item';
    friendEl.innerHTML = `<div class="friend-name">${friend.username}</div>`;
    
    friendEl.addEventListener('click', () => {
      openChat(friend);
    });
    
    friendsList.appendChild(friendEl);
  });
}

async function addFriend(friendCode: string) {
  try {
    const data = await apiCall('/users/add-friend', {
      method: 'POST',
      body: JSON.stringify({ friendCode })
    });
    
    if (data.success) {
      loadFriends();
      return data;
    }
  } catch (error) {
    throw error;
  }
}

// Chat Functions
function openChat(friend: any) {
  appState.currentFriend = friend;
  showView('chat');
  
  // Update chat header
  const chatFriendName = document.getElementById('chat-friend-name');
  if (chatFriendName) chatFriendName.textContent = friend.username;
  
  // Update friend selection in sidebar
  document.querySelectorAll('.friend-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Find and highlight the current friend
  const friendItems = document.querySelectorAll('.friend-item');
  friendItems.forEach(item => {
    if (item.textContent?.includes(friend.username)) {
      item.classList.add('active');
    }
  });
  
  loadConversation(friend.id);
}

async function loadConversation(friendId: number) {
  try {
    const data = await apiCall(`/messages/conversation/${friendId}`);
    
    if (data.success) {
      updateChatMessages(data.messages);
    }
  } catch (error) {
    console.error('Failed to load conversation:', error);
  }
}

function updateChatMessages(messages: any[]) {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;
  
  chatMessages.innerHTML = '';
  
  messages.forEach(message => {
    const messageEl = document.createElement('div');
    messageEl.className = 'message';
    
    const time = new Date(message.created_at).toLocaleTimeString();
    
    messageEl.innerHTML = `
      <div class="message-header">
        <span class="message-author">${message.sender_username}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${message.message_text}</div>
    `;
    
    chatMessages.appendChild(messageEl);
  });
  
  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage(recipientId: number, message: string) {
  try {
    const data = await apiCall('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ recipientId, message })
    });
    
    if (data.success) {
      loadConversation(recipientId);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Check for existing authentication
  const token = window.electronAPI.getItem('auth_token');
  if (token) {
    const isValid = await verifyToken();
    if (!isValid) {
      showAuthScreen();
    }
  } else {
    showAuthScreen();
  }
  
  // Auth tab switching
  document.getElementById('login-tab')?.addEventListener('click', () => {
    document.getElementById('login-tab')?.classList.add('active');
    document.getElementById('register-tab')?.classList.remove('active');
    document.getElementById('login-form')?.classList.add('active');
    document.getElementById('register-form')?.classList.remove('active');
  });
  
  document.getElementById('register-tab')?.addEventListener('click', () => {
    document.getElementById('register-tab')?.classList.add('active');
    document.getElementById('login-tab')?.classList.remove('active');
    document.getElementById('register-form')?.classList.add('active');
    document.getElementById('login-form')?.classList.remove('active');
  });
  
  // Login form
  document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = (document.getElementById('login-username') as HTMLInputElement).value;
    const password = (document.getElementById('login-password') as HTMLInputElement).value;
    const errorEl = document.getElementById('login-error');
    
    try {
      await login(username, password);
      if (errorEl) errorEl.textContent = '';
    } catch (error: any) {
      if (errorEl) errorEl.textContent = error.message;
    }
  });
  
  // Register form
  document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = (document.getElementById('register-username') as HTMLInputElement).value;
    const password = (document.getElementById('register-password') as HTMLInputElement).value;
    const confirm = (document.getElementById('register-confirm') as HTMLInputElement).value;
    const errorEl = document.getElementById('register-error');
    
    if (password !== confirm) {
      if (errorEl) errorEl.textContent = 'Passwords do not match';
      return;
    }
    
    try {
      await register(username, password);
      if (errorEl) errorEl.textContent = '';
    } catch (error: any) {
      if (errorEl) errorEl.textContent = error.message;
    }
  });
  
  // Home button
  document.getElementById('home-btn')?.addEventListener('click', () => {
    showView('home');
  });
  
  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  
  // Add friend modal
  document.getElementById('add-friend-btn')?.addEventListener('click', () => {
    document.getElementById('add-friend-modal')?.classList.add('active');
  });
  
  document.getElementById('close-modal')?.addEventListener('click', () => {
    document.getElementById('add-friend-modal')?.classList.remove('active');
  });
  
  document.getElementById('cancel-add-friend')?.addEventListener('click', () => {
    document.getElementById('add-friend-modal')?.classList.remove('active');
  });
  
  document.getElementById('confirm-add-friend')?.addEventListener('click', async () => {
    const friendCode = (document.getElementById('friend-code-input') as HTMLInputElement).value;
    const errorEl = document.getElementById('add-friend-error');
    
    try {
      await addFriend(friendCode);
      document.getElementById('add-friend-modal')?.classList.remove('active');
      (document.getElementById('friend-code-input') as HTMLInputElement).value = '';
      if (errorEl) errorEl.textContent = '';
    } catch (error: any) {
      if (errorEl) errorEl.textContent = error.message;
    }
  });
  
  // Send message
  document.getElementById('send-message-btn')?.addEventListener('click', async () => {
    if (!appState.currentFriend) return;
    
    const messageInput = document.getElementById('message-input') as HTMLInputElement;
    const message = messageInput.value.trim();
    
    if (message) {
      await sendMessage(appState.currentFriend.id, message);
      messageInput.value = '';
    }
  });
  
  // Send message on Enter
  document.getElementById('message-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('send-message-btn')?.click();
    }
  });
  
  // File sending (placeholder for now)
  document.getElementById('send-file-btn')?.addEventListener('click', async () => {
    if (!appState.currentFriend) return;
    
    // Use the existing file selection API
    try {
      const filePath = await window.electronAPI.selectFile();
      if (filePath) {
        // For now, just send a message about the file
        await sendMessage(appState.currentFriend.id, `📎 File: ${filePath.split('/').pop()}`);
      }
    } catch (error) {
      console.error('File selection failed:', error);
    }
  });
});