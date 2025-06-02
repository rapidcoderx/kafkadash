const API_PREFIX = '/api/v1';
const CONFIG = {
    host: window.location.hostname,
    port: window.location.port || '80',
    broker: 'localhost:9092'
};
let autoRefresh = true;
let refreshInterval;
let kafkaStartTime = null;
let clusterHealth = null;

// Theme handling
function initTheme() {
    const theme = localStorage.getItem('theme') || 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    updateThemeIcon(theme);
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark ? 'dark' : 'light');
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle i');
    icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// Refresh handling
function toggleAutoRefresh() {
    autoRefresh = !autoRefresh;
    const button = document.getElementById('auto-refresh-toggle');
    const icon = button.querySelector('i');
    
    if (autoRefresh) {
        icon.className = 'fas fa-pause';
        button.classList.remove('opacity-50');
        button.title = 'Auto Refresh: ON - Click to disable';
        startRefresh();
        console.log('Auto-refresh enabled');
    } else {
        icon.className = 'fas fa-play';
        button.classList.add('opacity-50');
        button.title = 'Auto Refresh: OFF - Click to enable';
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
}

function stopRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
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
    const statusIcon = document.querySelector('#kafka-info .fa-circle');
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
        const brokerCount = clusterHealth ? clusterHealth.activeBrokerCount : 1;
        hostInfo.textContent = `${CONFIG.host}:${CONFIG.port} (${brokerCount} brokers)`;
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
    
    if (uptime && clusterHealth && clusterHealth.uptime) {
        const elapsed = clusterHealth.uptime;
        const days = Math.floor(elapsed / (1000 * 60 * 60 * 24));
        const hours = Math.floor((elapsed % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
            uptime.textContent = `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            uptime.textContent = `${hours}h ${minutes}m`;
        } else {
            uptime.textContent = `${minutes}m`;
        }
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
    
    if (statusIcon) {
        statusIcon.className = 'fas fa-circle text-emerald-400';
        statusIcon.classList.remove('animate-pulse');
    }
}

// Toggle Kafka info details
function toggleKafkaInfoDetails() {
    const details = document.getElementById('kafka-info-details');
    const toggleButton = document.getElementById('toggle-kafka-info');
    const icon = toggleButton.querySelector('i');
    
    if (details.style.maxHeight && details.style.maxHeight !== '0px') {
        // Collapse
        details.style.maxHeight = '0px';
        details.style.opacity = '0';
        details.style.marginTop = '0px';
        icon.className = 'fas fa-chevron-down';
        toggleButton.title = 'Show Details';
        
        // Save collapsed state
        localStorage.setItem('kafkaInfoCollapsed', 'true');
    } else {
        // Expand
        details.style.maxHeight = details.scrollHeight + 'px';
        details.style.opacity = '1';
        details.style.marginTop = '';
        icon.className = 'fas fa-chevron-up';
        toggleButton.title = 'Hide Details';
        
        // Save expanded state
        localStorage.setItem('kafkaInfoCollapsed', 'false');
    }
}

// Initialize Kafka info collapse state
function initKafkaInfoState() {
    const details = document.getElementById('kafka-info-details');
    const toggleButton = document.getElementById('toggle-kafka-info');
    const icon = toggleButton.querySelector('i');
    const isCollapsed = localStorage.getItem('kafkaInfoCollapsed') === 'true';
    
    // Set initial transition properties
    details.style.transition = 'all 0.3s ease-in-out';
    details.style.overflow = 'hidden';
    
    if (isCollapsed) {
        details.style.maxHeight = '0px';
        details.style.opacity = '0';
        details.style.marginTop = '0px';
        icon.className = 'fas fa-chevron-down';
        toggleButton.title = 'Show Details';
    } else {
        details.style.maxHeight = 'none';
        details.style.opacity = '1';
        details.style.marginTop = '';
        icon.className = 'fas fa-chevron-up';
        toggleButton.title = 'Hide Details';
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

// Topic card creation
function createTopicCard(topic) {
    return `
        <div class="bg-white dark:bg-slate-800 rounded-lg shadow-sm hover:shadow-md dark:shadow-slate-900/30 p-6 transform transition-all duration-300 hover:scale-105 border border-gray-200 dark:border-slate-700">
            <div class="flex justify-between items-start mb-4">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-slate-100">${topic.name}</h3>
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                    ${topic.partitions || 1} partition${(topic.partitions || 1) !== 1 ? 's' : ''}
                </span>
            </div>
            <div class="space-y-3">
                <div class="flex items-center text-sm text-gray-600 dark:text-slate-400">
                    <i class="fas fa-layer-group mr-2 text-gray-400 dark:text-slate-500"></i>
                    <span class="font-medium mr-1">Replication Factor:</span>
                    <span>${topic.replicationFactor || 1}</span>
                </div>
                <div class="flex items-center text-sm text-gray-600 dark:text-slate-400">
                    <i class="fas fa-database mr-2 text-gray-400 dark:text-slate-500"></i>
                    <span class="font-medium mr-1">Total Messages:</span>
                    <span>${topic.depth || 0}</span>
                </div>
            </div>
            <div class="mt-6 flex gap-2">
                <button onclick="showTopicDetails('${topic.name}')" 
                        title="View topic details and recent messages"
                        class="flex-1 px-3 py-2 bg-indigo-600 dark:bg-indigo-500 text-white text-sm font-medium rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors whitespace-nowrap">
                    <i class="fas fa-info-circle mr-1.5"></i>
                    <span class="hidden sm:inline">Info</span>
                </button>
                <button onclick="showConsumers('${topic.name}')" 
                        title="View consumer groups for this topic"
                        class="flex-1 px-3 py-2 bg-green-600 dark:bg-green-500 text-white text-sm font-medium rounded-md hover:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors whitespace-nowrap">
                    <i class="fas fa-users mr-1.5"></i>
                    <span class="hidden sm:inline">Consumers</span>
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
    
    fetchTopicDetails(topicName);
}

function closeModal() {
    document.getElementById('topic-modal').classList.add('hidden');
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
                    <i class="fas fa-exclamation-triangle text-3xl"></i>
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
                        <i class="fas fa-inbox text-3xl text-gray-400 dark:text-slate-500 mb-2"></i>
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
                                                <i class="fas fa-eye"></i>
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
    
    fetchConsumers(topicName);
}

function closeConsumersModal() {
    document.getElementById('consumers-modal').classList.add('hidden');
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
                    <i class="fas fa-exclamation-triangle text-3xl"></i>
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
                    <i class="fas fa-users text-3xl text-gray-400 dark:text-slate-500 mb-2"></i>
                    <p class="text-gray-600 dark:text-slate-400">No active consumer groups found</p>
                    <p class="text-sm text-gray-500 dark:text-slate-500 mt-1">Consumer groups with active members will appear here</p>
                </div>
            ` : `
                <div class="grid gap-3">
                    ${activeConsumers.map(group => `
                        <div class="bg-gray-50 dark:bg-slate-700 p-4 rounded-lg border border-gray-200 dark:border-slate-600">
                            <div class="flex items-center justify-between">
                                <h4 class="text-sm font-medium text-gray-900 dark:text-slate-100">
                                    <i class="fas fa-users text-green-600 dark:text-green-400 mr-2"></i>
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
                            <i class="fas fa-code mr-1"></i>JSON
                        </span>
                    ` : `
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                            <i class="fas fa-file-text mr-1"></i>Text
                        </span>
                    `}
                </div>
                <div class="bg-gray-900 dark:bg-slate-900 p-4 rounded-lg overflow-auto max-h-96">
                    <pre class="text-green-400 text-sm font-mono whitespace-pre-wrap break-words">${formattedValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                </div>
            </div>
            
            <div class="flex justify-end space-x-3">
                <button onclick="copyMessageToClipboard('${btoa(message.value || '')}')" class="px-4 py-2 bg-indigo-600 dark:bg-indigo-500 text-white rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors text-sm">
                    <i class="fas fa-copy mr-2"></i>Copy Value
                </button>
                <button onclick="closeMessageModal()" class="px-4 py-2 bg-gray-300 dark:bg-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-400 dark:hover:bg-slate-500 transition-colors text-sm">
                    Close
                </button>
            </div>
        </div>
    `;
    
    messageModal.classList.remove('hidden');
}

function closeMessageModal() {
    document.getElementById('message-detail-modal').classList.add('hidden');
}

function copyMessageToClipboard(encodedValue) {
    try {
        const value = atob(encodedValue);
        navigator.clipboard.writeText(value).then(() => {
            const button = event.target.closest('button');
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check mr-2"></i>Copied!';
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
                            <i class="fas fa-inbox text-5xl mb-4"></i>
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
        const statusIcon = document.querySelector('#kafka-info .fa-circle');
        const connectionStatus = document.getElementById('connection-status');
        const liveDataIndicator = document.getElementById('live-data-indicator');
        
        if (statusIcon) {
            statusIcon.className = 'fas fa-circle text-red-500 animate-ping';
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
        
        const statusDot = document.getElementById('monitoring-status-dot');
        const statusText = document.getElementById('monitoring-status-text');
        if (statusDot && statusText) {
            statusDot.className = 'w-2 h-2 bg-red-500 rounded-full animate-ping';
            statusText.textContent = 'Monitoring Error';
        }
        
        const topicsGrid = document.getElementById('topics-grid');
        if (topicsGrid) {
            topicsGrid.innerHTML = `
                <div class="col-span-full text-center py-12">
                    <div class="text-red-500 dark:text-red-400">
                        <i class="fas fa-exclamation-circle text-5xl mb-4"></i>
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
    fetchTopics();
    
    const autoRefreshButton = document.getElementById('auto-refresh-toggle');
    const autoRefreshIcon = autoRefreshButton.querySelector('i');
    
    if (autoRefresh) {
        autoRefreshIcon.className = 'fas fa-pause';
        autoRefreshButton.classList.remove('opacity-50');
        autoRefreshButton.title = 'Auto Refresh: ON - Click to disable';
        startRefresh();
    } else {
        autoRefreshIcon.className = 'fas fa-play';
        autoRefreshButton.classList.add('opacity-50');
        autoRefreshButton.title = 'Auto Refresh: OFF - Click to enable';
    }
    
    updateMonitoringStatus();
    updateLiveDataIndicator();
    initKafkaInfoState();
    
    // Event listeners
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('manual-refresh').addEventListener('click', performManualRefresh);
    document.getElementById('auto-refresh-toggle').addEventListener('click', toggleAutoRefresh);
    document.getElementById('toggle-kafka-info').addEventListener('click', toggleKafkaInfoDetails);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('message-modal-close-btn').addEventListener('click', closeMessageModal);
    document.getElementById('consumers-modal-close-btn').addEventListener('click', closeConsumersModal);
    
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
});