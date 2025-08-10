class AgenticProtocol {
  constructor() {
    this.streamHealth = true;
    this.currentPath = '.';

    this.initializeElements();
    this.initializeEventListeners();
    this.initializeProjectTree();

    // Warm intro
    this.createMessage('assistant', `
Welcome to <strong>Agentic Dev</strong> — a streaming-first assistant for developer workflows. 
Ask me to inspect files, scaffold features, or run tools using the live protocol.
`);
  }

  initializeElements() {
    // Main elements
    this.conversationContainer = document.getElementById('conversationContainer');
    this.input = document.getElementById('input');
    this.sendBtn = document.getElementById('sendBtn');
    this.composerStatus = document.getElementById('composerStatus');
    this.tokensCount = document.getElementById('tokensCount');

    // Sidebar elements
    this.newSessionBtn = document.getElementById('newSessionBtn');
    this.clearWorkspaceBtn = document.getElementById('clearWorkspaceBtn');
    this.projectTree = document.getElementById('projectTree');
    this.refreshTree = document.getElementById('refreshTree');

    // Status elements
    this.streamHealthStatus = document.getElementById('streamHealth');

    // Theme
    this.themeToggle = document.getElementById('themeToggle');

    // Modals
    this.fileModal = document.getElementById('fileModal');

    // Configure marked for markdown rendering
    marked.setOptions({
      breaks: true,
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      }
    });
  }

  initializeEventListeners() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.input.addEventListener('input', () => this.updateTokenCount());
    this.newSessionBtn.addEventListener('click', () => this.newSession());
    this.clearWorkspaceBtn.addEventListener('click', () => this.clearWorkspace());
    this.refreshTree.addEventListener('click', () => this.loadProjectTree(this.currentPath));

    document.getElementById('closeFileModal').addEventListener('click', () => this.fileModal.classList.add('hidden'));
    this.fileModal.addEventListener('click', (e) => { if (e.target === this.fileModal) this.fileModal.classList.add('hidden'); });

    // Theme persistence
    const saved = localStorage.getItem('agentic-theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
    this.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('agentic-theme', next);
    });
  }

  async initializeProjectTree() {
    await this.loadProjectTree('.');
  }

  updateTokenCount() {
    const text = this.input.value;
    const tokens = Math.ceil(text.length / 4);
    this.tokensCount.textContent = `${tokens} tokens`;
  }

  updateStreamHealth(isHealthy) {
    this.streamHealth = isHealthy;
    this.streamHealthStatus.textContent = this.streamHealth ? '🟢 Healthy' : '🔴 Degraded';
    this.streamHealthStatus.className = `status-value ${this.streamHealth ? 'active' : ''}`;
  }

  async sendMessage() {
    const text = this.input.value.trim();
    if (!text) return;

    this.createMessage('user', text);
    this.input.value = '';
    this.updateTokenCount();
    this.composerStatus.textContent = 'Processing';
    this.composerStatus.className = 'status-indicator processing';

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      await this.handleStreamResponse(response);
    } catch (error) {
      console.error('Stream error:', error);
      this.updateStreamHealth(false);
      this.createMessage('assistant', `⚠️ **Stream Error**: ${error.message}`);
    } finally {
      this.composerStatus.textContent = 'Ready';
      this.composerStatus.className = 'status-indicator ready';
    }
  }

  async handleStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let currentMessage = null;
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              currentMessage = await this.processStreamChunk(parsed, currentMessage);
            } catch (e) {
              console.warn('Failed to parse chunk:', data, e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async processStreamChunk(chunk, currentMessage) {
    switch (chunk.type) {
      case 'content': {
        if (!currentMessage?.element) {
          currentMessage = this.createStreamingMessage();
        }
        currentMessage.content += chunk.content;
        currentMessage.element.innerHTML = marked.parse(currentMessage.content);
        this.enhanceCodeBlocks(currentMessage.element);
        this.scrollToBottom();
        break;
      }
      case 'tool_call_start': {
        this.createToolStatusMessage(chunk.tool_name);
        return null;
      }
      case 'tool_result': {
        this.createToolResultMessage(chunk.result, chunk.status);
        await this.loadProjectTree(this.currentPath);
        return null;
      }
      case 'error': {
        this.createMessage('assistant', `⚠️ **Error**: ${chunk.message}`);
        return null;
      }
      case 'complete':
        break;
    }
    return currentMessage;
  }

  // Messaging UI
  createMessage(role, text) {
    const wrapper = document.createElement('div');
    wrapper.className = `message ${role}`;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '👤' : '🧠';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const content = document.createElement('div');
    content.className = 'content';
    content.innerHTML = marked.parse(text || '');
    bubble.appendChild(content);
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    this.conversationContainer.appendChild(wrapper);
    this.enhanceCodeBlocks(content);
    this.scrollToBottom();
    return wrapper;
  }

  createStreamingMessage() {
    const wrapper = this.createMessage('assistant', '');
    return { element: wrapper.querySelector('.content'), content: '' };
  }

  createToolStatusMessage(toolName) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message tool-status-message';
    wrapper.innerHTML = `⚙️ Executing: <strong>${toolName}</strong>...`;
    this.conversationContainer.appendChild(wrapper);
    this.scrollToBottom();
  }

  createToolResultMessage(result, status) {
    const wrapper = document.createElement('div');
    const icon = status === 'success' ? '✅' : '❌';
    wrapper.className = `message tool-result-message ${status}`;
    wrapper.innerHTML = `
      <div class="result-icon">${icon}</div>
      <div class="result-content">
        <div class="result-header">${status.toUpperCase()}</div>
        <pre><code class="language-plaintext"></code></pre>
      </div>
    `;
    const codeEl = wrapper.querySelector('code');
    codeEl.textContent = result;
    this.conversationContainer.appendChild(wrapper);
    this.enhanceCodeBlocks(wrapper);
    this.scrollToBottom();
  }

  // Workspace
  newSession() {
    this.conversationContainer.innerHTML = '';
    this.createMessage('assistant', `
## New Session Started
I'm ready to help you with the new high-performance streaming protocol.
**Key Features:**
- **Simple Delimiters:** Instant tool recognition.
- **Immediate Execution:** Tools run as soon as they are defined.
- **Live Log:** Operations appear directly in our chat.
What would you like to work on?
    `);
  }

  clearWorkspace() {
    if (confirm('Are you sure you want to clear the workspace? This will remove all files and reset the project.')) {
      this.createMessage('assistant', '🧹 Workspace cleared successfully.');
      // Hook backend call here if required
    }
  }

  async loadProjectTree(path = '.') {
    try {
      this.currentPath = path;
      const response = await fetch(`/api/tree?path=${encodeURIComponent(path)}&t=${Date.now()}`);
      const data = await response.json();

      this.projectTree.innerHTML = '';
      if (data.error) {
        this.projectTree.innerHTML = `<div class="error">${data.error}</div>`;
        return;
      }
      if (!data.tree) return;

      const pathDisplay = document.createElement('div');
      pathDisplay.className = 'current-path';
      pathDisplay.innerHTML = `<strong>📁 ${data.current_path === '.' ? '(root)' : data.current_path}</strong>`;
      this.projectTree.appendChild(pathDisplay);

      if (data.parent_path !== null) {
        const parentLink = this.createTreeItem('.. (Parent Directory)', 'directory', () => this.navigateToDirectory(data.parent_path === '' ? '.' : data.parent_path));
        this.projectTree.appendChild(parentLink);
      }

      data.tree.forEach(item => {
        const handler = item.type === 'directory'
          ? () => this.navigateToDirectory(item.path)
          : () => this.openFilePreview(item.path);
        const treeItem = this.createTreeItem(item.name, item.type, handler);
        this.projectTree.appendChild(treeItem);
      });
    } catch (error) {
      console.error('Failed to load project tree:', error);
      this.projectTree.innerHTML = '<div class="error">Failed to load tree</div>';
    }
  }

  createTreeItem(name, type, onClick) {
    const item = document.createElement('div');
    item.className = `tree-item ${type === 'directory' ? 'folder' : 'file'}`;
    item.innerHTML = `${type === 'directory' ? '📁' : '📄'} ${name}`;
    item.onclick = onClick;
    return item;
  }

  async navigateToDirectory(path) {
    await this.loadProjectTree(path);
  }

  async openFilePreview(filename) {
    try {
      const response = await fetch(`/api/file?path=${encodeURIComponent(filename)}`);
      const data = await response.json();
      if (data.error) { alert(`Error: ${data.error}`); return; }
      if (data.content !== undefined) {
        document.getElementById('fileModalTitle').textContent = filename;
        const codeEl = document.getElementById('fileModalContent');
        codeEl.textContent = data.content;
        hljs.highlightElement(codeEl);
        this.fileModal.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error loading file:', error);
    }
  }

  enhanceCodeBlocks(element) {
    element.querySelectorAll('pre > code').forEach(code => {
      const pre = code.parentElement;
      if (!pre.querySelector('.copy-btn')) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', async () => {
          await navigator.clipboard.writeText(code.textContent);
          copyBtn.textContent = 'Copied!';
          setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
        });
        pre.style.position = 'relative';
        pre.appendChild(copyBtn);
      }
      if (!code.classList.contains('hljs')) {
        hljs.highlightElement(code);
      }
    });
  }

  scrollToBottom() {
    this.conversationContainer.scrollTop = this.conversationContainer.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.agentic = new AgenticProtocol();
});