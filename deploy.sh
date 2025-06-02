#!/bin/bash

# Kafka Dashboard Kubernetes Deployment Script
# This script helps deploy the Kafka Dashboard to Kubernetes

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE=${NAMESPACE:-default}
IMAGE_TAG=${IMAGE_TAG:-latest}
REGISTRY=${REGISTRY:-"your-registry"}
APP_NAME="kafkadash"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    
    # Check cluster connection
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check if namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_warning "Namespace '$NAMESPACE' does not exist"
        read -p "Create namespace '$NAMESPACE'? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kubectl create namespace "$NAMESPACE"
            log_success "Namespace '$NAMESPACE' created"
        else
            log_error "Deployment cancelled"
            exit 1
        fi
    fi
    
    log_success "Prerequisites check passed"
}

# Build Docker image
build_image() {
    log_info "Building Docker image..."
    
    if [ ! -f "Dockerfile" ]; then
        log_error "Dockerfile not found in current directory"
        exit 1
    fi
    
    # Build CSS first
    if [ -f "package.json" ]; then
        log_info "Building CSS assets..."
        npm run build || {
            log_warning "CSS build failed, continuing anyway..."
        }
    fi
    
    # Build Docker image
    docker build -t "${REGISTRY}/${APP_NAME}:${IMAGE_TAG}" . || {
        log_error "Docker build failed"
        exit 1
    }
    
    log_success "Docker image built: ${REGISTRY}/${APP_NAME}:${IMAGE_TAG}"
}

# Push Docker image
push_image() {
    log_info "Pushing Docker image to registry..."
    
    docker push "${REGISTRY}/${APP_NAME}:${IMAGE_TAG}" || {
        log_error "Docker push failed"
        exit 1
    }
    
    log_success "Docker image pushed to registry"
}

# Configure Kafka brokers
configure_kafka() {
    log_info "Configuring Kafka brokers..."
    
    read -p "Enter Kafka broker addresses (comma-separated, e.g., broker1:9092,broker2:9092): " KAFKA_BROKERS
    
    if [ -z "$KAFKA_BROKERS" ]; then
        log_warning "Using default Kafka broker: localhost:9092"
        KAFKA_BROKERS="localhost:9092"
    fi
    
    # Encode Kafka brokers in base64
    KAFKA_BROKERS_B64=$(echo -n "$KAFKA_BROKERS" | base64)
    
    # Update secrets.yaml
    if [ -f "k8s/secrets.yaml" ]; then
        sed -i.bak "s/KAFKA_BROKERS:.*/KAFKA_BROKERS: $KAFKA_BROKERS_B64/" k8s/secrets.yaml
        log_success "Kafka brokers configured in secrets.yaml"
    else
        log_error "k8s/secrets.yaml not found"
        exit 1
    fi
}

# Update deployment image
update_deployment_image() {
    log_info "Updating deployment image..."
    
    if [ -f "k8s/deployment.yaml" ]; then
        sed -i.bak "s|image:.*|image: ${REGISTRY}/${APP_NAME}:${IMAGE_TAG}|" k8s/deployment.yaml
        log_success "Deployment image updated"
    else
        log_error "k8s/deployment.yaml not found"
        exit 1
    fi
}

# Configure domain (for Istio)
configure_domain() {
    log_info "Configuring domain for Istio..."
    
    read -p "Enter your domain (e.g., kafkadash.yourdomain.com) or press Enter to skip: " DOMAIN
    
    if [ -n "$DOMAIN" ]; then
        if [ -f "k8s/istio-virtualservice.yaml" ]; then
            sed -i.bak "s/kafkadash\.local/$DOMAIN/g" k8s/istio-virtualservice.yaml
            log_success "Domain configured in istio-virtualservice.yaml"
        else
            log_warning "k8s/istio-virtualservice.yaml not found, skipping Istio configuration"
        fi
    else
        log_info "Skipping domain configuration"
    fi
}

# Deploy Kafka cluster
deploy_kafka() {
    log_info "Deploying Kafka cluster in KRaft mode..."
    
    if [ ! -f "k8s/kafka-kraft-complete.yaml" ]; then
        log_error "Kafka deployment file k8s/kafka-kraft-complete.yaml not found"
        exit 1
    fi
    
    # Apply Kafka deployment
    kubectl apply -f k8s/kafka-kraft-complete.yaml || {
        log_error "Failed to deploy Kafka cluster"
        exit 1
    }
    
    log_success "Kafka cluster deployment initiated"
    
    # Wait for Kafka to be ready
    log_info "Waiting for Kafka cluster to be ready..."
    kubectl wait --for=condition=ready pod -l app=kafka -n kafka --timeout=300s || {
        log_warning "Kafka cluster is taking longer than expected to start"
        log_info "You can check the status with: kubectl get pods -n kafka"
    }
    
    # Show Kafka cluster status
    log_info "Kafka cluster status:"
    kubectl get all -n kafka
    
    log_success "Kafka cluster deployed successfully!"
    
    # Show access information
    echo
    log_info "Kafka Access Information:"
    echo "  Internal Access: kafka-service.kafka.svc.cluster.local:9092"
    echo "  External Access: Use LoadBalancer IP on port 9094"
    echo "  Kafka UI: kubectl port-forward svc/kafka-ui-service 8080:8080 -n kafka"
    echo
    echo "Useful Kafka commands:"
    echo "  kubectl logs -f kafka-0 -n kafka"
    echo "  kubectl exec -it kafka-0 -n kafka -- kafka-topics.sh --list --bootstrap-server localhost:9092"
    echo
}

# Check Kafka deployment status
check_kafka_status() {
    log_info "Checking Kafka cluster status..."
    
    if ! kubectl get namespace kafka &> /dev/null; then
        log_error "Kafka namespace does not exist. Deploy Kafka first."
        return 1
    fi
    
    # Show all Kafka resources
    echo
    log_info "Kafka Resources:"
    kubectl get all -n kafka
    
    # Check if Kafka is ready
    echo
    log_info "Kafka Pod Status:"
    kubectl get pods -l app=kafka -n kafka
    
    # Show recent logs
    echo
    log_info "Recent Kafka Logs:"
    kubectl logs kafka-0 -n kafka --tail=10 2>/dev/null || {
        log_warning "Could not fetch Kafka logs (pod might not be ready yet)"
    }
    
    # Test Kafka connectivity
    echo
    log_info "Testing Kafka connectivity..."
    kubectl exec kafka-0 -n kafka -- kafka-topics.sh --list --bootstrap-server localhost:9092 2>/dev/null && {
        log_success "Kafka is responding to requests"
    } || {
        log_warning "Kafka is not ready or not responding"
    }
}

# Deploy to Kubernetes
deploy_k8s() {
    log_info "Deploying to Kubernetes namespace: $NAMESPACE"
    
    # Apply ConfigMap
    kubectl apply -f k8s/configmap.yaml -n "$NAMESPACE" || {
        log_error "Failed to apply ConfigMap"
        exit 1
    }
    
    # Apply Secrets
    kubectl apply -f k8s/secrets.yaml -n "$NAMESPACE" || {
        log_error "Failed to apply Secrets"
        exit 1
    }
    
    # Apply Deployment
    kubectl apply -f k8s/deployment.yaml -n "$NAMESPACE" || {
        log_error "Failed to apply Deployment"
        exit 1
    }
    
    # Apply Service
    kubectl apply -f k8s/service.yaml -n "$NAMESPACE" || {
        log_error "Failed to apply Service"
        exit 1
    }
    
    # Apply Istio configuration if available
    if [ -f "k8s/istio-virtualservice.yaml" ]; then
        read -p "Deploy Istio configuration? (Y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            kubectl apply -f k8s/istio-virtualservice.yaml -n "$NAMESPACE" || {
                log_warning "Failed to apply Istio configuration"
            }
        fi
    fi
    
    log_success "Kubernetes resources deployed"
}

# Check deployment status
check_deployment() {
    log_info "Checking deployment status..."
    
    # Wait for deployment to be ready
    kubectl rollout status deployment/"$APP_NAME" -n "$NAMESPACE" --timeout=300s || {
        log_error "Deployment failed to become ready"
        exit 1
    }
    
    # Show pod status
    log_info "Pod status:"
    kubectl get pods -l app="$APP_NAME" -n "$NAMESPACE"
    
    # Show service status
    log_info "Service status:"
    kubectl get svc -l app="$APP_NAME" -n "$NAMESPACE"
    
    # Show logs
    log_info "Recent logs:"
    kubectl logs -l app="$APP_NAME" -n "$NAMESPACE" --tail=10
    
    log_success "Deployment completed successfully!"
}

# Show help information
show_help() {
    echo -e "${BLUE}Kafka Dashboard Deployment Script${NC}"
    echo
    echo "Usage: $0 [OPTION]"
    echo
    echo "Options:"
    echo "  --auto               Full deployment in automated mode"
    echo "  --kafka-only         Deploy Kafka cluster only"
    echo "  --dashboard-only     Deploy Dashboard only (assumes Kafka exists)"
    echo "  --full               Deploy both Kafka and Dashboard"
    echo "  --status             Check Dashboard deployment status"
    echo "  --kafka-status       Check Kafka cluster status"
    echo "  --cleanup-kafka      Remove Kafka deployment"
    echo "  -h, --help          Show this help message"
    echo
    echo "Environment Variables:"
    echo "  NAMESPACE           Kubernetes namespace (default: default)"
    echo "  IMAGE_TAG           Docker image tag (default: latest)"
    echo "  REGISTRY            Docker registry (default: your-registry)"
    echo
    echo "Examples:"
    echo "  $0                           # Interactive mode"
    echo "  $0 --full                    # Deploy everything non-interactively"
    echo "  $0 --kafka-only              # Deploy only Kafka cluster"
    echo "  NAMESPACE=prod $0 --auto     # Deploy to 'prod' namespace"
    echo
}

# Cleanup function
cleanup() {
    log_info "Cleaning up backup files..."
    rm -f k8s/*.bak
}

# Show access information
show_access_info() {
    log_info "Access Information:"
    echo
    echo "Dashboard URL patterns:"
    echo "  - Internal (port-forward): http://localhost:8080/kafka/dashboard"
    echo "  - Service (if LoadBalancer): http://<external-ip>/kafka/dashboard"
    echo "  - Istio Gateway: https://<your-domain>/kafka/dashboard"
    echo
    echo "Port forward command for testing:"
    echo "  kubectl port-forward svc/${APP_NAME}-service 8080:80 -n $NAMESPACE"
    echo
    echo "Kafka cluster information:"
    if kubectl get namespace kafka &> /dev/null; then
        echo "  - Kafka is deployed in 'kafka' namespace"
        echo "  - Internal access: kafka-service.kafka.svc.cluster.local:9092"
        echo "  - Kafka UI: kubectl port-forward svc/kafka-ui-service 8080:8080 -n kafka"
    else
        echo "  - Kafka cluster not deployed (use option 6 or 8 to deploy)"
    fi
    echo
    echo "Useful commands:"
    echo "  kubectl get pods -l app=$APP_NAME -n $NAMESPACE"
    echo "  kubectl logs -f deployment/$APP_NAME -n $NAMESPACE"
    echo "  kubectl describe deployment $APP_NAME -n $NAMESPACE"
    if kubectl get namespace kafka &> /dev/null; then
        echo "  kubectl get pods -n kafka"
        echo "  kubectl logs -f kafka-0 -n kafka"
    fi
    echo
}

# Cleanup Kafka deployment
cleanup_kafka() {
    log_info "Cleaning up Kafka deployment..."
    
    read -p "Are you sure you want to delete the Kafka cluster? This will remove all data! (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        kubectl delete -f k8s/kafka-kraft-complete.yaml 2>/dev/null || {
            log_warning "Some Kafka resources might have already been deleted"
        }
        
        # Optionally delete persistent volumes
        read -p "Also delete Kafka persistent volumes (all data will be lost)? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kubectl delete pvc --all -n kafka 2>/dev/null || {
                log_warning "No persistent volumes found to delete"
            }
            log_success "Kafka cluster and data completely removed"
        else
            log_success "Kafka cluster removed (data preserved in PVs)"
        fi
    else
        log_info "Kafka cleanup cancelled"
    fi
}

# Main deployment function
main() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║              Kafka Dashboard K8s Deployment                ║"
    echo "║                                                            ║"
    echo "║  This script will help you deploy Kafka Dashboard to K8s   ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Set trap for cleanup
    trap cleanup EXIT
    
    # Parse command line arguments
    case "$1" in
        --auto)
            log_info "Running in automated mode"
            SKIP_INTERACTIVE=true
            OPTION=1
            ;;
        --kafka-only)
            log_info "Deploying Kafka cluster only"
            SKIP_INTERACTIVE=true
            OPTION=6
            ;;
        --dashboard-only)
            log_info "Deploying Dashboard only"
            SKIP_INTERACTIVE=true
            OPTION=4
            ;;
        --full)
            log_info "Deploying both Kafka and Dashboard"
            SKIP_INTERACTIVE=true
            OPTION=8
            ;;
        --status)
            log_info "Checking deployment status"
            SKIP_INTERACTIVE=true
            OPTION=5
            ;;
        --kafka-status)
            log_info "Checking Kafka status"
            SKIP_INTERACTIVE=true
            OPTION=7
            ;;
        --cleanup-kafka)
            log_info "Cleaning up Kafka deployment"
            SKIP_INTERACTIVE=true
            OPTION=9
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        "")
            SKIP_INTERACTIVE=false
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
    
    # Check prerequisites
    check_prerequisites
    
    # Ask what to do
    if [ "$SKIP_INTERACTIVE" = false ]; then
        echo
        echo "╔════════════════════════════════════════════════════════════╗"
        echo "║                    Deployment Options                      ║"
        echo "╠════════════════════════════════════════════════════════════╣"
        echo "║  Dashboard Deployment:                                     ║"
        echo "║  1) Full deployment (build, push, configure, deploy)       ║"
        echo "║  2) Build and push image only                              ║"
        echo "║  3) Configure and deploy only (image already available)    ║"
        echo "║  4) Deploy only (everything already configured)            ║"
        echo "║  5) Check deployment status                                ║"
        echo "║                                                            ║"
        echo "║  Kafka Cluster:                                            ║"
        echo "║  6) Deploy Kafka cluster (KRaft mode)                     ║"
        echo "║  7) Check Kafka cluster status                            ║"
        echo "║  8) Deploy both Kafka and Dashboard                       ║"
        echo "║  9) Cleanup Kafka deployment                              ║"
        echo "╚════════════════════════════════════════════════════════════╝"
        echo
        read -p "Choose an option [1-9]: " OPTION
    else
        OPTION=1
    fi
    
    case $OPTION in
        1)
            build_image
            push_image
            configure_kafka
            update_deployment_image
            configure_domain
            deploy_k8s
            check_deployment
            show_access_info
            ;;
        2)
            build_image
            push_image
            ;;
        3)
            configure_kafka
            update_deployment_image
            configure_domain
            deploy_k8s
            check_deployment
            show_access_info
            ;;
        4)
            deploy_k8s
            check_deployment
            show_access_info
            ;;
        5)
            check_deployment
            show_access_info
            ;;
        6)
            deploy_kafka
            ;;
        7)
            check_kafka_status
            ;;
        8)
            log_info "Deploying both Kafka cluster and Dashboard..."
            deploy_kafka
            echo
            log_info "Waiting 30 seconds for Kafka to stabilize before deploying Dashboard..."
            sleep 30
            
            # Auto-configure Kafka brokers for internal cluster
            log_info "Auto-configuring Kafka brokers for internal cluster..."
            KAFKA_BROKERS="kafka-service.kafka.svc.cluster.local:9092"
            KAFKA_BROKERS_B64=$(echo -n "$KAFKA_BROKERS" | base64)
            
            if [ -f "k8s/secrets.yaml" ]; then
                sed -i.bak "s/KAFKA_BROKERS:.*/KAFKA_BROKERS: $KAFKA_BROKERS_B64/" k8s/secrets.yaml
                log_success "Kafka brokers auto-configured for internal cluster"
            fi
            
            # Deploy dashboard
            build_image
            push_image
            update_deployment_image
            configure_domain
            deploy_k8s
            check_deployment
            show_access_info
            
            echo
            log_success "Both Kafka cluster and Dashboard deployed successfully!"
            echo
            log_info "Complete Access Information:"
            echo "  Kafka Internal: kafka-service.kafka.svc.cluster.local:9092"
            echo "  Kafka UI: kubectl port-forward svc/kafka-ui-service 8080:8080 -n kafka"
            echo "  Dashboard: kubectl port-forward svc/${APP_NAME}-service 8080:80 -n $NAMESPACE"
            ;;
        9)
            cleanup_kafka
            ;;
        *)
            log_error "Invalid option selected"
            exit 1
            ;;
    esac
    
    log_success "All operations completed successfully!"
}

# Script entry point
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
