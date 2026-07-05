/**
 * Keyboard Shortcuts Help Modal
 * Displays available keyboard shortcuts in a modal dialog
 * @version 1.0.0
 */

(function() {
  'use strict';
  
  class KeyboardShortcuts {
    constructor() {
      this.logger = window.Logger ? new Logger('Shortcuts') : console;
      this.modal = null;
      this.shortcuts = [
        {
          category: 'Navigation',
          items: [
            { keys: ['Ctrl', 'K'], mac: ['⌘', 'K'], description: 'Focus search' },
            { keys: ['Esc'], description: 'Clear search / Close dialog' },
            { keys: ['Home'], description: 'Scroll to top' },
            { keys: ['End'], description: 'Scroll to bottom' }
          ]
        },
        {
          category: 'Theme',
          items: [
            { keys: ['Alt', 'T'], description: 'Toggle dark/light theme' },
            { keys: ['Alt', 'A'], description: 'Auto theme (follow system)' }
          ]
        },
        {
          category: 'Help',
          items: [
            { keys: ['?'], description: 'Show this help dialog' },
            { keys: ['Alt', 'H'], description: 'Show keyboard shortcuts' }
          ]
        }
      ];
      
      this.init();
    }
    
    /**
     * Initialize keyboard shortcuts system
     */
    init() {
      this.createModal();
      this.attachGlobalListeners();
      this.logger.debug?.('Keyboard shortcuts initialized');
    }
    
    /**
     * Create the modal HTML structure
     */
    createModal() {
      const modal = document.createElement('div');
      modal.id = 'keyboard-shortcuts-modal';
      modal.className = 'shortcuts-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-labelledby', 'shortcuts-title');
      modal.setAttribute('aria-modal', 'true');
      modal.style.display = 'none';
      
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      
      modal.innerHTML = `
        <div class="shortcuts-overlay" role="presentation"></div>
        <div class="shortcuts-content">
          <div class="shortcuts-header">
            <h2 id="shortcuts-title">
              <span class="shortcuts-icon">⌨️</span>
              Keyboard Shortcuts
            </h2>
            <button class="shortcuts-close" aria-label="Close dialog" title="Close (Esc)">
              <span aria-hidden="true">×</span>
            </button>
          </div>
          
          <div class="shortcuts-body">
            ${this.shortcuts.map(category => `
              <div class="shortcuts-category">
                <h3 class="shortcuts-category-title">${category.category}</h3>
                <div class="shortcuts-list">
                  ${category.items.map(item => {
                    const keys = isMac && item.mac ? item.mac : item.keys;
                    return `
                      <div class="shortcut-item">
                        <div class="shortcut-keys">
                          ${keys.map(key => `<kbd class="shortcut-key">${key}</kbd>`).join('<span class="shortcut-plus">+</span>')}
                        </div>
                        <div class="shortcut-description">${item.description}</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="shortcuts-footer">
            <p class="shortcuts-hint">
              Press <kbd class="shortcut-key">?</kbd> or <kbd class="shortcut-key">Alt</kbd> + <kbd class="shortcut-key">H</kbd> to show this dialog anytime
            </p>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      this.modal = modal;
      
      // Attach modal-specific listeners
      modal.querySelector('.shortcuts-overlay').addEventListener('click', () => this.hide());
      modal.querySelector('.shortcuts-close').addEventListener('click', () => this.hide());
    }
    
    /**
     * Attach global keyboard listeners
     */
    attachGlobalListeners() {
      document.addEventListener('keydown', (e) => {
        // Show help with ? or Alt+H
        if (e.key === '?' || (e.altKey && e.key === 'h')) {
          e.preventDefault();
          this.show();
        }
        
        // Hide with Escape
        if (e.key === 'Escape' && this.isVisible()) {
          e.preventDefault();
          this.hide();
        }
        
        // Theme shortcuts
        if (e.altKey && e.key === 't') {
          e.preventDefault();
          this.toggleTheme();
        }
        
        if (e.altKey && e.key === 'a') {
          e.preventDefault();
          this.setAutoTheme();
        }
      });
    }
    
    /**
     * Show the shortcuts modal
     */
    show() {
      if (!this.modal) return;
      
      this.modal.style.display = 'flex';
      this.modal.classList.add('active');
      
      // Focus the close button for accessibility
      setTimeout(() => {
        this.modal.querySelector('.shortcuts-close').focus();
      }, 100);
      
      // Prevent body scroll
      document.body.style.overflow = 'hidden';
      
      this.logger.debug?.('Shortcuts modal shown');
    }
    
    /**
     * Hide the shortcuts modal
     */
    hide() {
      if (!this.modal) return;
      
      this.modal.classList.remove('active');
      setTimeout(() => {
        this.modal.style.display = 'none';
      }, 300);
      
      // Restore body scroll
      document.body.style.overflow = '';
      
      this.logger.debug?.('Shortcuts modal hidden');
    }
    
    /**
     * Check if modal is visible
     * @returns {boolean}
     */
    isVisible() {
      return this.modal && this.modal.style.display !== 'none';
    }
    
    /**
     * Toggle theme (triggered by Alt+T)
     */
    toggleTheme() {
      const themeButton = document.getElementById('themeToggleButton');
      if (themeButton) {
        themeButton.click();
      }
    }
    
    /**
     * Set auto theme (triggered by Alt+A)
     */
    setAutoTheme() {
      try {
        localStorage.removeItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('light-mode', !prefersDark);
        
        // Show notification
        this.showNotification(`Auto theme enabled (${prefersDark ? 'dark' : 'light'})`);
        
        this.logger.info?.('Auto theme enabled');
      } catch (e) {
        this.logger.error?.('Failed to set auto theme:', e);
      }
    }
    
    /**
     * Show a temporary notification
     * @param {string} message - Message to display
     */
    showNotification(message) {
      const notification = document.createElement('div');
      notification.className = 'shortcuts-notification';
      notification.textContent = message;
      document.body.appendChild(notification);
      
      setTimeout(() => notification.classList.add('show'), 10);
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
      }, 2000);
    }
  }
  
  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    window.keyboardShortcuts = new KeyboardShortcuts();
  });
  
})();
