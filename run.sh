#!/bin/bash
clear

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to read port from .env file
get_port_from_env() {
    if [ -f .env ]; then
        PORT=$(grep -E "^PORT=" .env | cut -d'=' -f2)
        echo ${PORT:-3000}
    else
        echo "3000"
    fi
}

# Get the port
PORT=$(get_port_from_env)

# Banner
echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                     Kafka Dashboard                         ║"
echo "║                                                            ║"
echo "║  A modern, responsive Kafka dashboard built with Node.js    ║"
echo "║  and Tailwind CSS.                                         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js >= 18.0.0"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo -e "${RED}Error: Node.js version must be >= 18.0.0${NC}"
    echo "Current version: $NODE_VERSION"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    echo "Creating .env file with default configuration..."
    cat > .env << EOL
# Server Configuration
PORT=3000
UI_PREFIX=/kafka
API_PREFIX=/api/v1
NODE_ENV=development

# Kafka Configuration
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=kafka-dashboard
KAFKA_CONSUMER_GROUP=kafka-dashboard-group

# Logging Configuration
LOG_LEVEL=info
LOG_FILE_PATH=logs
EOL
    echo -e "${GREEN}.env file created successfully${NC}"
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing dependencies...${NC}"
    npm install
fi

# Start the application
echo -e "${BLUE}Starting Kafka Dashboard...${NC}"
echo -e "${GREEN}Dashboard UI will be available at: http://localhost:${PORT}/kafka/dashboard${NC}"
echo -e "${GREEN}API endpoints will be available at: http://localhost:${PORT}/api/v1${NC}"
echo -e "${BLUE}Press Ctrl+C to stop the application${NC}"
echo ""

# Run the application
npm run dev 