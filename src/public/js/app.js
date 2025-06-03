const API_PREFIX = '/api/v1';
const CONFIG = {
    host: window.location.hostname,
    port: window.location.port || '80',
    broker: 'localhost:9092'
};
let autoRefresh = true;
let refreshInterval;
let uptimeInterval;
let kafkaStartTime = null;
let clusterHealth = null;

// Theme handling
function initTheme() {
    // Clear any existing theme first
    document.documentElement.classList.remove('dark');
    
    const theme = localStorage.getItem('theme') || 'light';
    console.log('Initializing theme:', theme);
    
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    }
    
    updateThemeIcon(theme);
    console.log('HTML classes after init:', document.documentElement.className);
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    console.log('Toggling theme from', currentTheme, 'to', newTheme);
    
    // Remove existing class and add new one
    document.documentElement.classList.remove('dark');
    if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
    }
    
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
    
    console.log('HTML classes after toggle:', document.documentElement.className);
    console.log('localStorage theme:', localStorage.getItem('theme'));
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle svg');
    if (icon) {
        if (theme === 'dark') {
            // Sun icon for dark mode
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>';
        } else {
            // Moon icon for light mode
            icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>';
        }
        console.log('Updated theme icon for theme:', theme);
    } else {
        console.error('Theme toggle icon not found');
    }
}

// Tooltip handling
function initTooltips() {
    // Add click handlers to all tooltip elements
    document.addEventListener('click', function(e) {
        const tooltip = e.target.closest('.tooltip');
        if (tooltip) {
            // Add clicked class to hide tooltip
            tooltip.classList.add('tooltip-clicked');
            
            // Remove the class after a short delay to allow tooltips to work again
            setTimeout(() => {
                tooltip.classList.remove('tooltip-clicked');
            }, 100);
            
            // Also blur the element to remove focus
            setTimeout(() => {
                tooltip.blur();
            }, 50);
        }
    });
    
    // Hide tooltips when pressing Escape
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.tooltip').forEach(tooltip => {
                tooltip.blur();
                tooltip.classList.add('tooltip-clicked');
                setTimeout(() => {
                    tooltip.classList.remove('tooltip-clicked');
                }, 100);
            });
        }
    });
}

// Refresh handling
function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    const button = document.getElementById('auto-refresh-toggle');
    const icon = button.querySelector('svg');
    
    if (autoRefresh) {
        // Pause icon for active state
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        // Active state - use emerald (matching the live indicator)
        button.className = 'tooltip tooltip-bottom w-12 h-12 flex items-center justify-center rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 transition-all duration-200 backdrop-blur-sm';
        button.title = 'Auto Refresh: ON - Click to disable';
        button.setAttribute('data-tooltip', 'Auto Refresh: ON - Click to disable');
        startRefresh();
        console.log('Auto-refresh enabled');
    } else {
        // Play icon for paused state
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        // Paused state - use red to indicate stopped
        button.className = 'tooltip tooltip-bottom w-12 h-12 flex items-center justify-center rounded-lg text-white bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-all duration-200 backdrop-blur-sm';
        button.title = 'Auto Refresh: OFF - Click to enable';
        button.setAttribute('data-tooltip', 'Auto Refresh: OFF - Click to enable');
        stopRefresh();
        console.log('Auto-refresh disabled');
    }
    
    updateMonitoringStatus();
    updateLiveDataIndicator();
}

function startRefresh() {
    stopRefresh();
    refreshInterval = setInterval(() => {
        if (autoRefresh) {
            fetchTopics();
        }
    }, 30000);
    
    // Start uptime counter that updates every second
    uptimeInterval = setInterval(() => {
        if (autoRefresh) {
            updateUptimeDisplay();
        }
    }, 1000);
}

function stopRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    if (uptimeInterval) {
        clearInterval(uptimeInterval);
        uptimeInterval = null;
    }
}

function performManualRefresh() {
    console.log('Manual refresh triggered');
    fetchTopics();
}

// Kafka info functions
function updateKafkaInfo(topics, kafkaInfo) {
    const kafkaInfoElement = document.getElementById('kafka-info');
    if (!kafkaInfoElement) return;

    const connectionStatus = document.getElementById('connection-status');
    const hostInfo = document.getElementById('host-info');
    const brokerInfo = document.getElementById('broker-info');
    const topicCount = document.getElementById('topic-count');
    const uptime = document.getElementById('uptime');
    const clusterId = document.getElementById('cluster-id');
    const controllerBroker = document.getElementById('controller-broker');
    const statusDot = document.querySelector('#kafka-info .status-dot');
    const liveDataIndicator = document.getElementById('live-data-indicator');

    if (connectionStatus) {
        connectionStatus.textContent = clusterHealth && clusterHealth.status === 'connected' 
            ? `Connected to Cluster: ${clusterHealth.clusterId}` 
            : 'Connected to Kafka';
    }
    
    // Update live data indicator based on auto-refresh state and connection
    if (liveDataIndicator) {
        const dot = liveDataIndicator.querySelector('div');
        if (dot) {
            if (autoRefresh) {
                dot.className = 'w-3 h-3 bg-emerald-400 rounded-full animate-pulse';
                dot.style.animationDuration = '';
            } else {
                dot.className = 'w-3 h-3 bg-amber-500 rounded-full animate-pulse';
                dot.style.animationDuration = '2s';
            }
        }
    }
    
    if (hostInfo) {
        hostInfo.textContent = `${CONFIG.host}:${CONFIG.port}`;
    }
    
    if (brokerInfo) {
        if (clusterHealth && clusterHealth.brokers.length > 0) {
            const primaryBroker = clusterHealth.brokers[0];
            brokerInfo.textContent = `${primaryBroker.host}:${primaryBroker.port}`;
        } else {
            brokerInfo.textContent = CONFIG.broker;
        }
    }
    
    if (topicCount) {
        topicCount.textContent = `${topics.length} topics`;
    }
    
    if (uptime && clusterHealth && clusterHealth.startTime) {
        // Store the start time for real-time updates
        const elapsed = Date.now() - clusterHealth.startTime;
        const hours = Math.floor(elapsed / (1000 * 60 * 60));
        const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
        
        uptime.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else if (uptime) {
        uptime.textContent = 'Unknown';
    }
    
    if (clusterId && clusterHealth) {
        clusterId.textContent = `Cluster: ${clusterHealth.clusterId}`;
    } else if (clusterId) {
        clusterId.textContent = 'Cluster: Unknown';
    }
    
    if (controllerBroker && clusterHealth) {
        controllerBroker.textContent = `Controller: ${clusterHealth.controllerBrokerId}`;
    } else if (controllerBroker) {
        controllerBroker.textContent = 'Controller: Unknown';
    }
    
    if (statusDot) {
        statusDot.className = 'w-3 h-3 bg-emerald-400 rounded-full';
    }
}

// Toggle Kafka info details
function toggleKafkaInfoDetails() {
    const details = document.getElementById('kafka-info-details');
    const toggleButton = document.getElementById('toggle-kafka-info');
    const icon = toggleButton.querySelector('svg');
    
    if (details.style.maxHeight && details.style.maxHeight !== '0px') {
        // Collapse
        details.style.maxHeight = '0px';
        details.style.opacity = '0';
        details.style.marginTop = '0px';
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>';
        toggleButton.title = 'Show Details';
        toggleButton.setAttribute('data-tooltip', 'Show Details');
        
        // Save collapsed state
        localStorage.setItem('kafkaInfoCollapsed', 'true');
    } else {
        // Expand
        details.style.maxHeight = details.scrollHeight + 'px';
        details.style.opacity = '1';
        details.style.marginTop = '';
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>';
        toggleButton.title = 'Hide Details';
        toggleButton.setAttribute('data-tooltip', 'Hide Details');
        
        // Save expanded state
        localStorage.setItem('kafkaInfoCollapsed', 'false');
    }
}

// Initialize Kafka info collapse state
function initKafkaInfoState() {
    const details = document.getElementById('kafka-info-details');
    const toggleButton = document.getElementById('toggle-kafka-info');
    const icon = toggleButton.querySelector('svg');
    const isCollapsed = localStorage.getItem('kafkaInfoCollapsed') === 'true';
    
    // Set initial transition properties
    details.style.transition = 'all 0.3s ease-in-out';
    details.style.overflow = 'hidden';
    
    if (isCollapsed) {
        details.style.maxHeight = '0px';
        details.style.opacity = '0';
        details.style.marginTop = '0px';
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>';
        toggleButton.title = 'Show Details';
        toggleButton.setAttribute('data-tooltip', 'Show Details');
    } else {
        details.style.maxHeight = 'none';
        details.style.opacity = '1';
        details.style.marginTop = '';
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>';
        toggleButton.title = 'Hide Details';
        toggleButton.setAttribute('data-tooltip', 'Hide Details');
    }
}

// Update monitoring status
function updateMonitoringStatus() {
    const statusDot = document.getElementById('monitoring-status-dot');
    const statusText = document.getElementById('monitoring-status-text');
    
    if (statusDot && statusText) {
        if (autoRefresh) {
            statusDot.className = 'w-2 h-2 bg-emerald-500 rounded-full animate-pulse';
            statusText.textContent = 'Live Monitoring';
        } else {
            statusDot.className = 'w-2 h-2 bg-amber-500 rounded-full';
            statusText.textContent = 'Monitoring Paused';
        }
    }
}

// Update live data indicator
function updateLiveDataIndicator() {
    const liveDataIndicator = document.getElementById('live-data-indicator');
    if (liveDataIndicator) {
        const dot = liveDataIndicator.querySelector('div');
        if (dot) {
            if (autoRefresh) {
                dot.className = 'w-3 h-3 bg-emerald-400 rounded-full animate-pulse';
                dot.style.animationDuration = '';
            } else {
                dot.className = 'w-3 h-3 bg-amber-500 rounded-full animate-pulse';
                dot.style.animationDuration = '2s';
            }
        }
    }
}

// Update uptime display in real-time
function updateUptimeDisplay() {
    const uptime = document.getElementById('uptime');
    if (uptime && clusterHealth && clusterHealth.startTime) {
        const elapsed = Date.now() - clusterHealth.startTime;
        const hours = Math.floor(elapsed / (1000 * 60 * 60));
        const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((elapsed % (1000 * 60)) / 1000);
        
        uptime.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Fetch cluster health information
async function fetchClusterHealth() {
    try {
        const response = await fetch(`${API_PREFIX}/cluster/health`);
        if (response.ok) {
            clusterHealth = await response.json();
        } else {
            console.warn('Failed to fetch cluster health');
        }
    } catch (error) {
        console.error('Error fetching cluster health:', error);
        clusterHealth = null;
    }
}

// Generate a subtle color theme based on topic name
function getTopicColorTheme(topicName) {
    // Create a simple hash from the topic name for consistent color assignment
    let hash = 0;
    for (let i = 0; i < topicName.length; i++) {
        const char = topicName.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Define subtle color themes that work well in both light and dark modes
    const colorThemes = [
        {
            // Soft Blue
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            border: 'border-blue-200 dark:border-blue-800/50',
            accent: 'bg-blue-100 dark:bg-blue-800/40',
            accentText: 'text-blue-800 dark:text-blue-200',
            icon: 'text-blue-500 dark:text-blue-400'
        },
        {
            // Soft Green
            bg: 'bg-emerald-50 dark:bg-emerald-900/20',
            border: 'border-emerald-200 dark:border-emerald-800/50',
            accent: 'bg-emerald-100 dark:bg-emerald-800/40',
            accentText: 'text-emerald-800 dark:text-emerald-200',
            icon: 'text-emerald-500 dark:text-emerald-400'
        },
        {
            // Soft Purple
            bg: 'bg-purple-50 dark:bg-purple-900/20',
            border: 'border-purple-200 dark:border-purple-800/50',
            accent: 'bg-purple-100 dark:bg-purple-800/40',
            accentText: 'text-purple-800 dark:text-purple-200',
            icon: 'text-purple-500 dark:text-purple-400'
        },
        {
            // Soft Orange
            bg: 'bg-orange-50 dark:bg-orange-900/20',
            border: 'border-orange-200 dark:border-orange-800/50',
            accent: 'bg-orange-100 dark:bg-orange-800/40',
            accentText: 'text-orange-800 dark:text-orange-200',
            icon: 'text-orange-500 dark:text-orange-400'
        },
        {
            // Soft Teal
            bg: 'bg-teal-50 dark:bg-teal-900/20',
            border: 'border-teal-200 dark:border-teal-800/50',
            accent: 'bg-teal-100 dark:bg-teal-800/40',
            accentText: 'text-teal-800 dark:text-teal-200',
            icon: 'text-teal-500 dark:text-teal-400'
        },
        {
            // Soft Rose
            bg: 'bg-rose-50 dark:bg-rose-900/20',
            border: 'border-rose-200 dark:border-rose-800/50',
            accent: 'bg-rose-100 dark:bg-rose-800/40',
            accentText: 'text-rose-800 dark:text-rose-200',
            icon: 'text-rose-500 dark:text-rose-400'
        },
        {
            // Soft Amber
            bg: 'bg-amber-50 dark:bg-amber-900/20',
            border: 'border-amber-200 dark:border-amber-800/50',
            accent: 'bg-amber-100 dark:bg-amber-800/40',
            accentText: 'text-amber-800 dark:text-amber-200',
            icon: 'text-amber-500 dark:text-amber-400'
        },
        {
            // Soft Cyan
            bg: 'bg-cyan-50 dark:bg-cyan-900/20',
            border: 'border-cyan-200 dark:border-cyan-800/50',
            accent: 'bg-cyan-100 dark:bg-cyan-800/40',
            accentText: 'text-cyan-800 dark:text-cyan-200',
            icon: 'text-cyan-500 dark:text-cyan-400'
        }
    ];
    
    // Select theme based on hash
    const themeIndex = Math.abs(hash) % colorThemes.length;
    return colorThemes[themeIndex];
}

// Topic card creation
function createTopicCard(topic) {
    const colorTheme = getTopicColorTheme(topic.name);
    
    return `
        <div class="${colorTheme.bg} rounded-lg shadow-sm hover:shadow-md dark:shadow-slate-900/30 p-6 transform transition-all duration-300 hover:scale-105 border ${colorTheme.border}">
            <div class="flex justify-between items-start mb-4">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-slate-100">${topic.name}</h3>
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorTheme.accent} ${colorTheme.accentText}">
                    ${topic.partitions || 1} partition${(topic.partitions || 1) !== 1 ? 's' : ''}
                </span>
            </div>
            <div class="space-y-3">
                <div class="flex items-center text-sm text-gray-600 dark:text-slate-400">
                    <svg class="w-4 h-4 mr-2 ${colorTheme.icon}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                    </svg>
                    <span class="font-medium mr-1">Replication Factor:</span>
                    <span>${topic.replicationFactor || 1}</span>
                </div>
                <div class="flex items-center text-sm text-gray-600 dark:text-slate-400">
                    <svg class="w-4 h-4 mr-2 ${colorTheme.icon}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
                    </svg>
                    <span class="font-medium mr-1">Total Messages:</span>
                    <span class="font-semibold ${colorTheme.accentText}">${topic.depth || 0}</span>
                </div>
            </div>
            <div class="mt-6 flex gap-2">
                <button onclick="showTopicDetails('${topic.name}')" 
                        class="tooltip tooltip-top flex-1 px-3 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm font-medium rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors flex items-center justify-center"
                        data-tooltip="View topic details and recent messages"
                        title="View topic details and recent messages">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </button>
                <button onclick="showProducer('${topic.name}')" 
                        class="tooltip tooltip-top flex-1 px-3 py-2 bg-orange-600 dark:bg-orange-500 text-white text-sm font-medium rounded-md hover:bg-orange-700 dark:hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors flex items-center justify-center"
                        data-tooltip="Produce a message to this topic"
                        title="Produce a message to this topic">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
                    </svg>
                </button>
                <button onclick="showConsumers('${topic.name}')" 
                        class="tooltip tooltip-top flex-1 px-3 py-2 bg-green-600 dark:bg-green-500 text-white text-sm font-medium rounded-md hover:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors flex items-center justify-center"
                        data-tooltip="View consumer groups"
                        title="View consumer groups">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

// Modal handling
function showTopicDetails(topicName) {
    const modal = document.getElementById('topic-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    
    modalTitle.textContent = topicName;
    modalContent.innerHTML = `
        <div class="text-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
            <p class="mt-3 text-gray-600 dark:text-slate-400">Loading topic details...</p>
        </div>
    `;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    fetchTopicDetails(topicName);
}

function closeModal() {
    const modal = document.getElementById('topic-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function fetchTopicDetails(topicName) {
    try {
        const messagesResponse = await fetch(`${API_PREFIX}/topics/${topicName}/messages`);
        
        let messages = [];
        
        if (messagesResponse.ok) {
            messages = await messagesResponse.json();
        } else if (messagesResponse.status === 404) {
            messages = [];
        } else {
            throw new Error(`Failed to fetch messages: ${messagesResponse.status}`);
        }
        
        displayTopicDetails(topicName, messages);
    } catch (error) {
        console.error('Error fetching topic details:', error);
        document.getElementById('modal-content').innerHTML = `
            <div class="text-center py-8">
                <div class="text-red-500 dark:text-red-400 mb-3">
                    <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path>
                    </svg>
                </div>
                <p class="text-gray-700 dark:text-slate-300 font-medium">Error loading topic details</p>
                <p class="text-gray-500 dark:text-slate-400 text-sm mt-1">${error.message}</p>
            </div>
        `;
    }
}

function displayTopicDetails(topicName, messages) {
    window.currentTopicMessages = messages;
    
    if (messages.length > 0) {
        messages.sort((a, b) => {
            const timestampA = a.timestamp ? parseInt(a.timestamp) : 0;
            const timestampB = b.timestamp ? parseInt(b.timestamp) : 0;
            return timestampB - timestampA;
        });
    }
    
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <div class="space-y-6">
            <div>
                <h3 class="text-lg font-medium text-gray-900 dark:text-slate-100 mb-3">Recent Messages</h3>
                ${messages.length === 0 ? `
                    <div class="text-center py-6 bg-gray-50 dark:bg-slate-700 rounded-lg border border-gray-200 dark:border-slate-600">
                        <svg class="w-12 h-12 mx-auto text-gray-400 dark:text-slate-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
                        </svg>
                        <p class="text-gray-600 dark:text-slate-400">No messages found in this topic</p>
                        <p class="text-sm text-gray-500 dark:text-slate-500 mt-1">Messages will appear here when produced</p>
                    </div>
                ` : `
                    <div class="overflow-x-auto">
                        <table class="min-w-full bg-white dark:bg-slate-800 rounded-lg overflow-hidden">
                            <thead class="bg-gray-50 dark:bg-slate-700">
                                <tr>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-300 uppercase tracking-wider">Timestamp</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-300 uppercase tracking-wider">Key</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-300 uppercase tracking-wider">Partition</th>
                                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-300 uppercase tracking-wider">Offset</th>
                                    <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-300 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-200 dark:divide-slate-600">
                                ${messages.slice(0, 10).map((msg, index) => `
                                    <tr class="hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors">
                                        <td class="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                                            ${msg.timestamp ? `
                                                <div class="flex flex-col">
                                                    <span class="font-medium">${new Date(parseInt(msg.timestamp)).toLocaleDateString()}</span>
                                                    <span class="text-xs text-gray-500 dark:text-slate-400">${new Date(parseInt(msg.timestamp)).toLocaleTimeString()}</span>
                                                </div>
                                            ` : `<span class="text-gray-400 dark:text-slate-500 italic">N/A</span>`}
                                        </td>
                                        <td class="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                                            <span class="font-mono text-xs bg-gray-100 dark:bg-slate-600 px-2 py-1 rounded">${msg.key || 'N/A'}</span>
                                        </td>
                                        <td class="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">${msg.partition !== undefined ? msg.partition : 'N/A'}</td>
                                        <td class="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">${msg.offset !== undefined ? msg.offset : 'N/A'}</td>
                                        <td class="px-4 py-3 text-right">
                                            <button onclick="showMessageDetails(${index}, '${topicName}')" class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors p-1 rounded" title="View Message Details">
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>
    `;
}

// Consumers modal handling
function showConsumers(topicName) {
    const modal = document.getElementById('consumers-modal');
    const modalTitle = document.getElementById('consumers-modal-title');
    const modalContent = document.getElementById('consumers-modal-content');
    
    modalTitle.textContent = `Consumer Groups - ${topicName}`;
    modalContent.innerHTML = `
        <div class="text-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 dark:border-green-400"></div>
            <p class="mt-3 text-gray-600 dark:text-slate-400">Loading consumer groups...</p>
        </div>
    `;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    fetchConsumers(topicName);
}

function closeConsumersModal() {
    const modal = document.getElementById('consumers-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function fetchConsumers(topicName) {
    try {
        const response = await fetch(`${API_PREFIX}/topics/${topicName}/consumers`);
        
        let consumers = [];
        
        if (response.ok) {
            consumers = await response.json();
        } else if (response.status === 404) {
            consumers = [];
        } else {
            throw new Error(`Failed to fetch consumers: ${response.status}`);
        }
        
        displayConsumers(consumers);
    } catch (error) {
        console.error('Error fetching consumers:', error);
        document.getElementById('consumers-modal-content').innerHTML = `
            <div class="text-center py-8">
                <div class="text-red-500 dark:text-red-400 mb-3">
                    <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path>
                    </svg>
                </div>
                <p class="text-gray-700 dark:text-slate-300 font-medium">Error loading consumer groups</p>
                <p class="text-gray-500 dark:text-slate-400 text-sm mt-1">${error.message}</p>
            </div>
        `;
    }
}

function displayConsumers(consumers) {
    // Filter out consumer groups with 0 members
    const activeConsumers = consumers.filter(group => group.members && group.members.length > 0);
    
    const modalContent = document.getElementById('consumers-modal-content');
    modalContent.innerHTML = `
        <div class="space-y-4">
            ${activeConsumers.length === 0 ? `
                <div class="text-center py-6 bg-gray-50 dark:bg-slate-700 rounded-lg border border-gray-200 dark:border-slate-600">
                    <svg class="w-12 h-12 mx-auto text-gray-400 dark:text-slate-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                    </svg>
                    <p class="text-gray-600 dark:text-slate-400">No active consumer groups found</p>
                    <p class="text-sm text-gray-500 dark:text-slate-500 mt-1">Consumer groups with active members will appear here</p>
                </div>
            ` : `
                <div class="grid gap-3">
                    ${activeConsumers.map(group => `
                        <div class="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg border border-gray-200 dark:border-slate-600">
                            <div class="flex items-center justify-between">
                                <h4 class="text-sm font-medium text-gray-900 dark:text-slate-100">
                                    <svg class="w-4 h-4 inline text-green-600 dark:text-green-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                                    </svg>
                                    ${group.groupId}
                                </h4>
                                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                    ${group.members.length} members
                                </span>
                            </div>
                            <div class="mt-3 pt-3 border-t border-gray-200 dark:border-slate-600">
                                <h5 class="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Members</h5>
                                <div class="space-y-1">
                                    ${group.members.map(member => `
                                        <div class="text-sm text-gray-600 dark:text-slate-400 font-mono bg-white dark:bg-slate-600 px-2 py-1 rounded">
                                            ${member.memberId || 'Unknown Member'}
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}
        </div>
    `;
}

// Message details modal
function showMessageDetails(messageIndex, topicName) {
    const message = window.currentTopicMessages[messageIndex];
    if (!message) {
        console.error('Message not found');
        return;
    }
    
    const messageModal = document.getElementById('message-detail-modal');
    const modalTitle = document.getElementById('message-modal-title');
    const modalContent = document.getElementById('message-modal-content');
    
    modalTitle.textContent = `Message Details - ${topicName}`;
    
    let formattedValue = message.value || 'null';
    let isJson = false;
    
    try {
        if (message.value) {
            const parsed = JSON.parse(message.value);
            formattedValue = JSON.stringify(parsed, null, 2);
            isJson = true;
        }
    } catch (e) {
        // Not JSON, keep as is
    }
    
    modalContent.innerHTML = `
        <div class="space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
                    <h4 class="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">Message Metadata</h4>
                    <dl class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <dt class="text-gray-600 dark:text-slate-400">Partition:</dt>
                            <dd class="text-gray-900 dark:text-slate-100 font-mono">${message.partition !== undefined ? message.partition : 'N/A'}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-gray-600 dark:text-slate-400">Offset:</dt>
                            <dd class="text-gray-900 dark:text-slate-100 font-mono">${message.offset !== undefined ? message.offset : 'N/A'}</dd>
                        </div>
                        <div class="flex justify-between">
                            <dt class="text-gray-600 dark:text-slate-400">Timestamp:</dt>
                            <dd class="text-gray-900 dark:text-slate-100">
                                ${message.timestamp ? `
                                    <div>
                                        <div class="font-mono">${new Date(parseInt(message.timestamp)).toLocaleString()}</div>
                                        <div class="text-xs text-gray-500 dark:text-slate-400">${message.timestamp}</div>
                                    </div>
                                ` : 'N/A'}
                            </dd>
                        </div>
                    </dl>
                </div>
                
                <div class="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg">
                    <h4 class="text-sm font-medium text-gray-900 dark:text-slate-100 mb-2">Message Key</h4>
                    <div class="bg-white dark:bg-slate-600 p-3 rounded border font-mono text-sm break-all">
                        ${message.key || '<span class="text-gray-400 dark:text-slate-500 italic">No key</span>'}
                    </div>
                </div>
            </div>
            
            <div>
                <div class="flex items-center justify-between mb-3">
                    <h4 class="text-sm font-medium text-gray-900 dark:text-slate-100">Message Value</h4>
                    ${isJson ? `
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path>
                            </svg>JSON
                        </span>
                    ` : `
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                            <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                            </svg>Text
                        </span>
                    `}
                </div>
                <div class="bg-gray-900 dark:bg-slate-900 p-4 rounded-lg overflow-auto max-h-96">
                    <pre class="text-green-400 text-sm font-mono whitespace-pre-wrap break-words">${formattedValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                </div>
            </div>
            
            <div class="flex justify-end space-x-3">
                <button onclick="copyMessageToClipboard('${btoa(message.value || '')}')" class="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-sm">
                    <svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                    </svg>Copy Value
                </button>
                <button onclick="closeMessageModal()" class="px-4 py-2 bg-gray-300 dark:bg-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-400 dark:hover:bg-slate-500 transition-colors text-sm">
                    Close
                </button>
            </div>
        </div>
    `;
    
    messageModal.classList.remove('hidden');
    messageModal.classList.add('flex');
}

function closeMessageModal() {
    const modal = document.getElementById('message-detail-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function copyMessageToClipboard(encodedValue) {
    try {
        const value = atob(encodedValue);
        navigator.clipboard.writeText(value).then(() => {
            const button = event.target.closest('button');
            const originalText = button.innerHTML;
            button.innerHTML = '<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Copied!';
            button.classList.add('bg-green-600', 'hover:bg-green-700');
            button.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.classList.remove('bg-green-600', 'hover:bg-green-700');
                button.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    } catch (err) {
        console.error('Failed to decode message: ', err);
    }
}

// Producer modal handling
function showProducer(topicName) {
    const modal = document.getElementById('producer-modal');
    const modalTitle = document.getElementById('producer-modal-title');
    const form = document.getElementById('producer-form');
    
    modalTitle.textContent = `Produce Message - ${topicName}`;
    
    // Reset form
    form.reset();
    
    // Reset headers to single row
    const headersContainer = document.getElementById('headers-container');
    headersContainer.innerHTML = `
        <div class="flex gap-2">
            <input type="text" placeholder="Header key" 
                   class="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-orange-500 focus:border-orange-500 dark:bg-slate-700 dark:text-slate-100">
            <input type="text" placeholder="Header value" 
                   class="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-orange-500 focus:border-orange-500 dark:bg-slate-700 dark:text-slate-100">
            <button type="button" onclick="removeHeaderRow(this)" 
                    class="px-3 py-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
            </button>
        </div>
    `;
    
    // Store current topic for form submission
    form.dataset.topic = topicName;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeProducerModal() {
    const modal = document.getElementById('producer-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function addHeaderRow() {
    const headersContainer = document.getElementById('headers-container');
    const headerRow = document.createElement('div');
    headerRow.className = 'flex gap-2';
    headerRow.innerHTML = `
        <input type="text" placeholder="Header key" 
               class="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-orange-500 focus:border-orange-500 dark:bg-slate-700 dark:text-slate-100">
        <input type="text" placeholder="Header value" 
               class="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-orange-500 focus:border-orange-500 dark:bg-slate-700 dark:text-slate-100">
        <button type="button" onclick="removeHeaderRow(this)" 
                class="tooltip tooltip-top px-3 py-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors"
                data-tooltip="Remove header" title="Remove header">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
        </button>
    `;
    headersContainer.appendChild(headerRow);
}

function removeHeaderRow(button) {
    const headersContainer = document.getElementById('headers-container');
    if (headersContainer.children.length > 1) {
        button.closest('.flex').remove();
    }
}

async function submitProducerForm(event) {
    event.preventDefault();
    
    const form = event.target;
    const topicName = form.dataset.topic;
    const submitBtn = document.getElementById('produce-submit-btn');
    const originalBtnText = submitBtn.innerHTML;
    
    // Disable submit button and show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>Producing...';
    
    try {
        // Collect form data
        const key = document.getElementById('message-key').value.trim() || null;
        const value = document.getElementById('message-value').value;
        
        // Collect headers
        const headers = {};
        const headerRows = document.querySelectorAll('#headers-container .flex');
        headerRows.forEach(row => {
            const keyInput = row.querySelector('input:first-child');
            const valueInput = row.querySelector('input:nth-child(2)');
            if (keyInput.value.trim() && valueInput.value.trim()) {
                headers[keyInput.value.trim()] = valueInput.value.trim();
            }
        });
        
        // Send request
        const response = await fetch(`${API_PREFIX}/topics/${topicName}/produce`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                key,
                value,
                headers: Object.keys(headers).length > 0 ? headers : undefined
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // Success feedback
            submitBtn.innerHTML = '<svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Message Sent!';
            submitBtn.classList.remove('bg-orange-600', 'hover:bg-orange-700');
            submitBtn.classList.add('bg-green-600', 'hover:bg-green-700');
            
            // Show success notification
            showNotification(`Message successfully sent to ${topicName}`, 'success', {
                partition: result.partition,
                offset: result.offset
            });
            
            // Close modal after delay
            setTimeout(() => {
                closeProducerModal();
                
                // Reset button
                submitBtn.innerHTML = originalBtnText;
                submitBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
                submitBtn.classList.add('bg-orange-600', 'hover:bg-orange-700');
                submitBtn.disabled = false;
            }, 1500);
            
        } else {
            throw new Error(result.message || result.error || 'Failed to produce message');
        }
        
    } catch (error) {
        console.error('Error producing message:', error);
        
        // Error feedback
        submitBtn.innerHTML = '<svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path></svg>Error';
        submitBtn.classList.remove('bg-orange-600', 'hover:bg-orange-700');
        submitBtn.classList.add('bg-red-600', 'hover:bg-red-700');
        
        // Show error notification
        showNotification(`Failed to send message: ${error.message}`, 'error');
        
        // Reset button after delay
        setTimeout(() => {
            submitBtn.innerHTML = originalBtnText;
            submitBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
            submitBtn.classList.add('bg-orange-600', 'hover:bg-orange-700');
            submitBtn.disabled = false;
        }, 3000);
    }
}

// Create Topic modal handling
function showCreateTopicModal() {
    const modal = document.getElementById('create-topic-modal');
    const form = document.getElementById('create-topic-form');
    
    // Reset form
    form.reset();
    
    // Set default values
    document.getElementById('num-partitions').value = '1';
    document.getElementById('replication-factor').value = '1';
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeCreateTopicModal() {
    const modal = document.getElementById('create-topic-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function submitCreateTopicForm(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = document.getElementById('create-topic-submit-btn');
    const originalBtnText = submitBtn.innerHTML;
    
    // Disable submit button and show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>Creating...';
    
    try {
        // Collect form data
        const topicName = document.getElementById('topic-name').value.trim();
        const numPartitions = parseInt(document.getElementById('num-partitions').value) || 1;
        const replicationFactor = parseInt(document.getElementById('replication-factor').value) || 1;
        
        // Validate topic name
        if (!topicName) {
            throw new Error('Topic name is required');
        }
        
        if (!/^[a-zA-Z0-9._-]+$/.test(topicName)) {
            throw new Error('Topic name can only contain letters, numbers, dots, underscores, and hyphens');
        }
        
        // Send request
        const response = await fetch(`${API_PREFIX}/topics`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                topicName,
                numPartitions,
                replicationFactor
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            // Success feedback
            submitBtn.innerHTML = '<svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>Topic Created!';
            submitBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
            submitBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
            
            // Show success notification
            showNotification(`Topic "${topicName}" created successfully`, 'success', {
                partitions: numPartitions,
                replicationFactor: replicationFactor
            });
            
            // Close modal after delay
            setTimeout(() => {
                closeCreateTopicModal();
                
                // Reset button
                submitBtn.innerHTML = originalBtnText;
                submitBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
                submitBtn.classList.add('bg-green-600', 'hover:bg-green-700');
                submitBtn.disabled = false;
                
                // Refresh topics list
                fetchTopics();
            }, 1500);
            
        } else {
            throw new Error(result.message || result.error || 'Failed to create topic');
        }
        
    } catch (error) {
        console.error('Error creating topic:', error);
        
        // Error feedback
        submitBtn.innerHTML = '<svg class="w-4 h-4 inline mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"></path></svg>Error';
        submitBtn.classList.remove('bg-green-600', 'hover:bg-green-700');
        submitBtn.classList.add('bg-red-600', 'hover:bg-red-700');
        
        // Show error notification
        showNotification(`Failed to create topic: ${error.message}`, 'error');
        
        // Reset button after delay
        setTimeout(() => {
            submitBtn.innerHTML = originalBtnText;
            submitBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
            submitBtn.classList.add('bg-green-600', 'hover:bg-green-700');
            submitBtn.disabled = false;
        }, 3000);
    }
}

function showNotification(message, type = 'info', details = null) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 z-[9999] max-w-sm w-full transform transition-all duration-300 translate-x-full`;
    
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    const iconSVG = type === 'success' 
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
        : type === 'error' 
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>';
    
    notification.innerHTML = `
        <div class="${bgColor} text-white p-4 rounded-lg shadow-lg">
            <div class="flex items-start">
                <svg class="w-5 h-5 mt-0.5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    ${iconSVG}
                </svg>
                <div class="flex-1">
                    <p class="font-medium">${message}</p>
                    ${details ? `<p class="text-sm mt-1 opacity-90">Partition: ${details.partition}, Offset: ${details.offset}</p>` : ''}
                </div>
                <button onclick="this.parentElement.parentElement.remove()" class="ml-3 text-white hover:text-gray-200">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.remove('translate-x-full');
    }, 100);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.classList.add('translate-x-full');
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, 5000);
}

// Main data fetching
async function fetchTopics() {
    try {
        await fetchClusterHealth();
        
        const response = await fetch(`${API_PREFIX}/topics`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const topics = data.topics || [];
        const kafkaInfo = data.kafkaInfo || {};

        const topicsGrid = document.getElementById('topics-grid');
        if (topicsGrid) {
            if (topics.length === 0) {
                topicsGrid.innerHTML = `
                    <div class="col-span-full text-center py-12">
                        <div class="text-gray-400 dark:text-slate-500">
                            <svg class="w-20 h-20 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
                            </svg>
                            <p class="text-xl font-medium">No Topics Found</p>
                            <p class="text-sm mt-2">Topics will appear here once they are created in Kafka</p>
                        </div>
                    </div>
                `;
            } else {
                topicsGrid.innerHTML = topics.map(topic => createTopicCard(topic)).join('');
            }
        }
        
        updateKafkaInfo(topics, kafkaInfo);
    } catch (error) {
        console.error('Error fetching topics:', error);
        const kafkaStatusDot = document.querySelector('#kafka-info .status-dot');
        const connectionStatus = document.getElementById('connection-status');
        const liveDataIndicator = document.getElementById('live-data-indicator');
        
        if (kafkaStatusDot) {
            kafkaStatusDot.className = 'w-3 h-3 bg-red-500 rounded-full animate-ping';
        }
        if (connectionStatus) {
            connectionStatus.textContent = 'Error connecting to Kafka';
        }
        
        if (liveDataIndicator) {
            const dot = liveDataIndicator.querySelector('div');
            if (dot) {
                dot.className = 'w-3 h-3 bg-red-500 rounded-full animate-ping';
            }
        }
        
        const monitoringStatusDot = document.getElementById('monitoring-status-dot');
        const statusText = document.getElementById('monitoring-status-text');
        if (monitoringStatusDot && statusText) {
            monitoringStatusDot.className = 'w-2 h-2 bg-red-500 rounded-full animate-ping';
            statusText.textContent = 'Monitoring Error';
        }
        
        const topicsGrid = document.getElementById('topics-grid');
        if (topicsGrid) {
            topicsGrid.innerHTML = `
                <div class="col-span-full text-center py-12">
                    <div class="text-red-500 dark:text-red-400">
                        <svg class="w-20 h-20 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <p class="text-xl font-medium">Error connecting to Kafka</p>
                        <p class="text-sm mt-2 text-gray-600 dark:text-slate-400">Please check your Kafka connection settings</p>
                    </div>
                </div>
            `;
        }
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTooltips();
    fetchTopics();
    
    const autoRefreshButton = document.getElementById('auto-refresh-toggle');
    const autoRefreshIcon = autoRefreshButton.querySelector('svg');
    
    if (autoRefresh) {
        autoRefreshIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        autoRefreshButton.className = 'tooltip tooltip-bottom w-12 h-12 flex items-center justify-center rounded-lg text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 transition-all duration-200 backdrop-blur-sm';
        autoRefreshButton.title = 'Auto Refresh: ON - Click to disable';
        autoRefreshButton.setAttribute('data-tooltip', 'Auto Refresh: ON - Click to disable');
        startRefresh();
    } else {
        autoRefreshIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';
        autoRefreshButton.className = 'tooltip tooltip-bottom w-12 h-12 flex items-center justify-center rounded-lg text-white bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-all duration-200 backdrop-blur-sm';
        autoRefreshButton.title = 'Auto Refresh: OFF - Click to enable';
        autoRefreshButton.setAttribute('data-tooltip', 'Auto Refresh: OFF - Click to enable');
    }
    
    updateMonitoringStatus();
    updateLiveDataIndicator();
    initKafkaInfoState();
    
    // Event listeners
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function(e) {
            console.log('Theme toggle button clicked');
            e.preventDefault();
            toggleTheme();
        });
        console.log('Theme toggle event listener attached');
    } else {
        console.error('Theme toggle button not found');
    }
    
    document.getElementById('manual-refresh').addEventListener('click', performManualRefresh);
    document.getElementById('auto-refresh-toggle').addEventListener('click', toggleAutoRefresh);
    document.getElementById('toggle-kafka-info').addEventListener('click', toggleKafkaInfoDetails);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('message-modal-close-btn').addEventListener('click', closeMessageModal);
    document.getElementById('consumers-modal-close-btn').addEventListener('click', closeConsumersModal);
    document.getElementById('producer-modal-close-btn').addEventListener('click', closeProducerModal);
    document.getElementById('producer-form').addEventListener('submit', submitProducerForm);
    
    // Modal outside click handlers
    document.getElementById('topic-modal').addEventListener('click', (e) => {
        if (e.target.id === 'topic-modal') closeModal();
    });
    
    document.getElementById('message-detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'message-detail-modal') closeMessageModal();
    });
    
    document.getElementById('consumers-modal').addEventListener('click', (e) => {
        if (e.target.id === 'consumers-modal') closeConsumersModal();
    });
    
    document.getElementById('producer-modal').addEventListener('click', (e) => {
        if (e.target.id === 'producer-modal') closeProducerModal();
    });
    
    document.getElementById('create-topic-modal').addEventListener('click', (e) => {
        if (e.target.id === 'create-topic-modal') closeCreateTopicModal();
    });
});