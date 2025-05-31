const API_PREFIX = '/api/v1';
const UI_PREFIX = '/kafka';
let autoRefresh = true;
let refreshInterval;

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
function toggleRefresh() {
    autoRefresh = !autoRefresh;
    const button = document.getElementById('refresh-toggle');
    button.textContent = `Auto Refresh: ${autoRefresh ? 'ON' : 'OFF'}`;
    
    if (autoRefresh) {
        startRefresh();
    } else {
        stopRefresh();
    }
}

function startRefresh() {
    refreshInterval = setInterval(fetchTopics, 5000);
}

function stopRefresh() {
    clearInterval(refreshInterval);
}

// Topic card creation
function createTopicCard(topic) {
    return `
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-6 transform transition-all duration-300 hover:scale-105">
            <div class="flex justify-between items-start mb-4">
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${topic.name}</h3>
                <button onclick="showTopicDetails('${topic.name}')" class="text-blue-600 hover:text-blue-700">
                    <i class="fas fa-info-circle"></i>
                </button>
            </div>
            <div class="space-y-2">
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    Messages: <span class="font-medium text-gray-900 dark:text-white">${topic.depth}</span>
                </p>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                    Partitions: <span class="font-medium text-gray-900 dark:text-white">${topic.partitions}</span>
                </p>
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
    modalContent.innerHTML = '<div class="animate-pulse">Loading...</div>';
    modal.classList.remove('hidden');
    
    fetchTopicDetails(topicName);
}

function closeModal() {
    document.getElementById('topic-modal').classList.add('hidden');
}

async function fetchTopicDetails(topicName) {
    try {
        const [messages, consumers] = await Promise.all([
            fetch(`${API_PREFIX}/topics/${topicName}/messages`).then(r => r.json()),
            fetch(`${API_PREFIX}/topics/${topicName}/consumers`).then(r => r.json())
        ]);
        
        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = `
            <div class="space-y-6">
                <div>
                    <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">Recent Messages</h3>
                    <div class="space-y-2">
                        ${messages.map(msg => `
                            <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-md">
                                <p class="text-sm text-gray-600 dark:text-gray-300">
                                    Key: ${msg.key || 'N/A'}
                                </p>
                                <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                    Value: ${msg.value || 'N/A'}
                                </p>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div>
                    <h3 class="text-lg font-medium text-gray-900 dark:text-white mb-2">Consumer Groups</h3>
                    <div class="space-y-2">
                        ${consumers.map(group => `
                            <div class="bg-gray-50 dark:bg-gray-700 p-3 rounded-md">
                                <p class="text-sm font-medium text-gray-900 dark:text-white">${group.groupId}</p>
                                <p class="text-sm text-gray-500 dark:text-gray-400">
                                    Members: ${group.members.length}
                                </p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Error fetching topic details:', error);
        document.getElementById('modal-content').innerHTML = `
            <div class="text-red-500">Error loading topic details</div>
        `;
    }
}

// Main data fetching
async function fetchTopics() {
    try {
        const response = await fetch(`${API_PREFIX}/topics`);
        const topics = await response.json();
        
        const topicsGrid = document.getElementById('topics-grid');
        topicsGrid.innerHTML = topics.map(createTopicCard).join('');
        
        // Update Kafka info
        document.getElementById('kafka-info').textContent = 
            `Connected to ${topics.length} topics`;
    } catch (error) {
        console.error('Error fetching topics:', error);
        document.getElementById('kafka-info').textContent = 
            'Error connecting to Kafka';
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchTopics();
    if (autoRefresh) {
        startRefresh();
    }
    
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    document.getElementById('refresh-toggle').addEventListener('click', toggleRefresh);
}); 