// PWA Installation and Management
// Version 2.3.1 - Enhanced with better notifications and cache management
class PWAManager {
  constructor() {
    this.deferredPrompt = null;
    this.isInstalled = false;
    this.logger = window.Logger ? new Logger('PWA') : console;
    this.init();
  }

  init() {
    // Check if already installed
    this.checkInstallStatus();
    
    // Register service worker
    this.registerServiceWorker();
    
    // Setup install prompt via Footer button
    this.setupInstallPrompt();
    
    // Listen for app updates
    this.setupUpdateListener();
    
    // Add cache management button
    this.setupCacheManagement();
  }

  checkInstallStatus() {
    // Check if running as installed PWA
    this.isInstalled = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;
    
    if (this.isInstalled) {
      this.logger.info?.('Running as installed app');
      this.hideInstallPrompt();
    }
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        this.logger.info?.('Service Worker registered', registration);
        
        // Listen for updates
        registration.addEventListener('updatefound', () => {
          this.logger.info?.('New version available');
          const newWorker = registration.installing;
          if (!newWorker) return;
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              this.showUpdateAvailable(registration);
            }
          });
        });
        
        // Store registration for later use
        this.registration = registration;
      } catch (error) {
        this.logger.error?.('Service Worker registration failed', error);
      }
    }
  }

  setupInstallPrompt() {
    const installBtn = document.getElementById('pwa-install-btn');

    // Setup the click listener for the footer button
    if (installBtn) {
      installBtn.addEventListener('click', () => {
        this.triggerInstall();
      });
    }

    // Listen for the browser's install prompt event
    window.addEventListener('beforeinstallprompt', (e) => {
      this.logger.info?.('Install prompt available');
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      this.deferredPrompt = e;
      
      // Reveal the button in the footer instead of a popup
      if (installBtn && !this.isInstalled) {
        installBtn.style.display = 'flex';
      }
    });

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      this.logger.info?.('Successfully installed');
      this.isInstalled = true;
      this.hideInstallPrompt();
      this.showInstallSuccess();
    });
  }

  async triggerInstall() {
    if (!this.deferredPrompt) return;

    try {
      const result = await this.deferredPrompt.prompt();
      console.log('PWA: Install prompt result', result);
      
      if (result.outcome === 'accepted') {
        console.log('PWA: User accepted install');
        this.hideInstallPrompt();
      }
      
      this.deferredPrompt = null;
      
    } catch (error) {
      console.error('PWA: Install failed', error);
    }
  }

  hideInstallPrompt() {
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
      // Hide the button from the footer
      installBtn.style.display = 'none';
    }
  }

  showInstallSuccess() {
    // Show temporary success message toast
    const successMsg = document.createElement('div');
    successMsg.id = 'pwa-success-banner';
    successMsg.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-text">
          ✅ <strong>Successfully installed!</strong>
          <p>You can now access patchnotes offline</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(successMsg);
    document.body.classList.add('pwa-banner-active');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      successMsg.classList.add('pwa-banner-exiting');
      setTimeout(() => {
        successMsg.remove();
        document.body.classList.remove('pwa-banner-active');
      }, 300);
    }, 3000);
  }

  setupUpdateListener() {
    // Listen for service worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('PWA: App updated');
        this.showUpdateComplete();
      });
    }
  }

  showUpdateAvailable() {
    // Add body class to adjust layout
    document.body.classList.add('pwa-banner-active');
    
    // Show update banner
    const updateBanner = document.createElement('div');
    updateBanner.id = 'pwa-update-banner';
    updateBanner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-text">
          <strong>Update Available</strong>
          <p>New patches and improvements ready</p>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-update-btn" class="pwa-btn pwa-btn-primary">Update</button>
          <button id="pwa-update-dismiss-btn" class="pwa-btn pwa-btn-secondary">Later</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(updateBanner);
    
    // Add event listeners
    document.getElementById('pwa-update-btn').addEventListener('click', () => {
      this.hideUpdateBanner();
      window.location.reload();
    });
    
    document.getElementById('pwa-update-dismiss-btn').addEventListener('click', () => {
      this.hideUpdateBanner();
    });
  }

  hideUpdateBanner() {
    const banner = document.getElementById('pwa-update-banner');
    if (banner) {
      // Add exit animation
      banner.classList.add('pwa-banner-exiting');
      
      // Remove banner and body class after animation
      setTimeout(() => {
        banner.remove();
        document.body.classList.remove('pwa-banner-active');
      }, 300);
    }
  }

  showUpdateComplete() {
    // Show update complete message
    const completeMsg = document.createElement('div');
    completeMsg.id = 'pwa-complete-banner';
    completeMsg.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-text">
          ✅ <strong>Updated!</strong>
          <p>You're now running the latest version</p>
        </div>
      </div>
    `;
    
    document.body.appendChild(completeMsg);
    document.body.classList.add('pwa-banner-active');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      completeMsg.classList.add('pwa-banner-exiting');
      setTimeout(() => {
        completeMsg.remove();
        document.body.classList.remove('pwa-banner-active');
      }, 300);
    }, 3000);
  }
  
  /**
   * Setup cache management UI
   */
  setupCacheManagement() {
    // Add cache management to footer if desired
    // This gives users control over cached data
    document.addEventListener('DOMContentLoaded', () => {
      this.addCacheManagementButton();
    });
  }
  
  /**
   * Add cache management button to UI
   */
  addCacheManagementButton() {
    const footer = document.querySelector('.SiteFooter .FooterActions');
    if (!footer) return;
    
    const cacheButton = document.createElement('button');
    cacheButton.className = 'CacheManageButton';
    cacheButton.innerHTML = `
      <i class="fas fa-database" aria-hidden="true"></i>
      <span>Clear Cache</span>
    `;
    cacheButton.setAttribute('title', 'Clear cached data');
    cacheButton.addEventListener('click', () => this.showCacheManagement());
    
    footer.appendChild(cacheButton);
  }
  
  /**
   * Show cache management dialog
   */
  async showCacheManagement() {
    const cacheInfo = await this.getCacheInfo();
    
    const modal = document.createElement('div');
    modal.className = 'pwa-cache-modal';
    modal.innerHTML = `
      <div class="pwa-cache-overlay"></div>
      <div class="pwa-cache-content">
        <div class="pwa-cache-header">
          <h3>🗄️ Cache Management</h3>
          <button class="pwa-cache-close" aria-label="Close">×</button>
        </div>
        <div class="pwa-cache-body">
          <div class="cache-info">
            <p><strong>Stored Data:</strong> ${cacheInfo.size}</p>
            <p><strong>Cached Items:</strong> ${cacheInfo.count} files</p>
            <p class="cache-note">Clearing cache will remove offline data. It will be re-downloaded on your next visit.</p>
          </div>
          <div class="cache-actions">
            <button class="btn btn-danger" id="clear-all-cache">
              <i class="fas fa-trash" aria-hidden="true"></i>
              Clear All Cache
            </button>
            <button class="btn btn-secondary" id="refresh-cache">
              <i class="fas fa-sync" aria-hidden="true"></i>
              Refresh Cache
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    modal.querySelector('.pwa-cache-overlay').addEventListener('click', () => modal.remove());
    modal.querySelector('.pwa-cache-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#clear-all-cache').addEventListener('click', async () => {
      await this.clearAllCache();
      modal.remove();
    });
    modal.querySelector('#refresh-cache').addEventListener('click', async () => {
      await this.refreshCache();
      modal.remove();
    });
  }
  
  /**
   * Get cache information
   * @returns {Object} Cache info with size and count
   */
  async getCacheInfo() {
    if (!('caches' in window)) {
      return { size: 'Unknown', count: 0 };
    }
    
    try {
      const cacheNames = await caches.keys();
      let totalCount = 0;
      
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        totalCount += keys.length;
      }
      
      // Estimate size (rough approximation)
      const sizeEstimate = totalCount * 50; // Rough estimate: 50KB per file
      const sizeMB = (sizeEstimate / 1024).toFixed(2);
      
      return {
        size: `~${sizeMB} MB`,
        count: totalCount
      };
    } catch (error) {
      this.logger.error?.('Failed to get cache info:', error);
      return { size: 'Unknown', count: 0 };
    }
  }
  
  /**
   * Clear all caches
   */
  async clearAllCache() {
    if (!('caches' in window)) return;
    
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
      
      this.showNotification('✅ Cache cleared successfully', 'success');
      this.logger.info?.('All caches cleared');
      
     // Reload after short delay
      setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
      this.logger.error?.('Failed to clear cache:', error);
      this.showNotification('❌ Failed to clear cache', 'error');
    }
  }
  
  /**
   * Refresh cache by reloading and updating service worker
   */
  async refreshCache() {
    try {
      if (this.registration) {
        await this.registration.update();
        this.showNotification('🔄 Cache refreshed', 'success');
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (error) {
      this.logger.error?.('Failed to refresh cache:', error);
      this.showNotification('❌ Failed to refresh cache', 'error');
    }
  }
  
  /**
   * Show notification toast
   * @param {string} message - Message to show
   * @param {string} type - 'success' or 'error'
   */
  showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `pwa-notification pwa-notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Initialize PWA when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PWAManager();
});