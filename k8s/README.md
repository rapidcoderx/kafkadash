# Kafka Dashboard Kubernetes Deployment

This directory contains all the necessary Kubernetes manifests to deploy the Kafka Dashboard application.

## Prerequisites

- Kubernetes cluster (v1.19+)
- kubectl configured to access your cluster
- Istio service mesh installed (for Istio configurations)
- Docker image built and available in your registry

## Quick Start

### 1. Build and Push Docker Image

```bash
# Build the Docker image
docker build -t your-registry/kafkadash:latest .

# Push to your registry
docker push your-registry/kafkadash:latest
```

### 2. Update Configuration

**Update the Docker image reference in `deployment.yaml`:**
```yaml
image: your-registry/kafkadash:latest  # Update this line
```

**Update Kafka brokers in `secrets.yaml`:**
```bash
# Encode your Kafka brokers
echo -n "your-kafka-broker-1:9092,your-kafka-broker-2:9092" | base64

# Update the KAFKA_BROKERS value in secrets.yaml
```

**Update domain in `istio-virtualservice.yaml`:**
```yaml
hosts:
- your-domain.com  # Update with your actual domain
```

### 3. Deploy to Kubernetes

```bash
# Create namespace (optional)
kubectl create namespace kafkadash

# Apply all manifests
kubectl apply -f k8s/

# Or apply individually in order:
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/istio-virtualservice.yaml  # If using Istio
```

### 4. Verify Deployment

```bash
# Check pod status
kubectl get pods -l app=kafkadash

# Check service
kubectl get svc kafkadash-service

# Check logs
kubectl logs -l app=kafkadash -f

# Port forward for testing (if not using Istio)
kubectl port-forward svc/kafkadash-service 8080:80
```

## Files Description

### `Dockerfile`
- Multi-stage build optimized for production
- Non-root user for security
- Health checks included
- Uses Node.js 18 Alpine for smaller image size

### `configmap.yaml`
- Application configuration (non-sensitive)
- Environment variables for the application
- Logging and performance settings

### `secrets.yaml`
- Sensitive configuration (Kafka brokers, credentials)
- Base64 encoded values
- Includes examples for SASL/SSL authentication

### `deployment.yaml`
- Kubernetes Deployment with 2 replicas
- Security contexts and resource limits
- Health checks (liveness and readiness probes)
- Volume mounts for logs and temporary files
- Pod anti-affinity for high availability

### `service.yaml`
- ClusterIP service for internal communication
- Headless service for direct pod access
- Port mapping from 80 to 4010

### `istio-virtualservice.yaml`
- Istio Gateway for external access
- VirtualService with routing rules
- DestinationRule for traffic policies
- HTTPS redirect and TLS termination
- Advanced traffic management (retries, timeouts, circuit breaker)

## Configuration Options

### Environment Variables

| Variable | Description | Default | Source |
|----------|-------------|---------|--------|
| `PORT` | Application port | `4010` | ConfigMap |
| `KAFKA_BROKERS` | Kafka broker addresses | `localhost:9092` | Secret |
| `NODE_ENV` | Node.js environment | `production` | ConfigMap |
| `LOG_LEVEL` | Logging level | `info` | ConfigMap |
| `CACHE_TTL` | Cache time-to-live (ms) | `30000` | ConfigMap |

### Security Configuration

#### Basic Setup
The deployment includes:
- Non-root container execution
- Security contexts
- Resource limits
- Network policies (can be added)

#### SASL Authentication
For Kafka clusters with SASL authentication, uncomment and configure:
```yaml
env:
- name: KAFKA_USERNAME
  valueFrom:
    secretKeyRef:
      name: kafkadash-secrets
      key: KAFKA_USERNAME
- name: KAFKA_PASSWORD
  valueFrom:
    secretKeyRef:
      name: kafkadash-secrets
      key: KAFKA_PASSWORD
```

#### SSL/TLS Configuration
For SSL-enabled Kafka clusters, add certificates to secrets and mount as volumes.

### Istio Configuration

#### Prerequisites
- Istio installed in the cluster
- Istio sidecar injection enabled in the namespace

#### TLS Certificate
Create a TLS secret for HTTPS:
```bash
kubectl create secret tls kafkadash-tls-secret \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem
```

#### Custom Domain
Update the hosts in `istio-virtualservice.yaml`:
```yaml
hosts:
- kafkadash.yourdomain.com
```

## Monitoring and Observability

### Health Checks
- **Liveness Probe**: Checks if the application is running
- **Readiness Probe**: Checks if the application is ready to serve traffic
- **Startup Probe**: Gives extra time for application startup

### Logs
```bash
# View application logs
kubectl logs -l app=kafkadash -f

# View specific pod logs
kubectl logs <pod-name> -f
```

### Metrics (with Istio)
Istio automatically provides metrics for:
- Request rate
- Request duration
- Request size
- Response size
- Error rate

Access via Prometheus/Grafana dashboards.

## Scaling

### Horizontal Scaling
```bash
# Scale to 5 replicas
kubectl scale deployment kafkadash --replicas=5

# Auto-scaling (requires metrics-server)
kubectl autoscale deployment kafkadash --cpu-percent=70 --min=2 --max=10
```

### Vertical Scaling
Update resource limits in `deployment.yaml`:
```yaml
resources:
  requests:
    memory: "256Mi"
    cpu: "200m"
  limits:
    memory: "1Gi"
    cpu: "1"
```

## Troubleshooting

### Common Issues

1. **Pod not starting**
   ```bash
   kubectl describe pod <pod-name>
   kubectl logs <pod-name>
   ```

2. **Cannot connect to Kafka**
   - Check Kafka broker addresses in secrets
   - Verify network connectivity
   - Check Kafka authentication settings

3. **Istio gateway not working**
   - Verify Istio installation
   - Check gateway and virtual service configuration
   - Ensure DNS resolution for custom domains

### Debug Commands
```bash
# Check all resources
kubectl get all -l app=kafkadash

# Check configuration
kubectl get configmap kafkadash-config -o yaml
kubectl get secret kafkadash-secrets -o yaml

# Check Istio configuration
kubectl get gateway,virtualservice,destinationrule -l app=kafkadash

# Port forward for direct testing
kubectl port-forward svc/kafkadash-service 8080:80
```

## Security Best Practices

1. **Use specific image tags** instead of `latest`
2. **Enable network policies** to restrict traffic
3. **Use Pod Security Standards** or Pod Security Policies
4. **Regularly update base images** and dependencies
5. **Scan images** for vulnerabilities
6. **Use secrets** for sensitive configuration
7. **Enable audit logging** in Kubernetes
8. **Configure RBAC** appropriately

## Production Considerations

1. **Resource allocation**: Set appropriate CPU/memory limits
2. **Persistent storage**: Consider persistent volumes for logs
3. **High availability**: Use multiple replicas and pod anti-affinity
4. **Monitoring**: Set up comprehensive monitoring and alerting
5. **Backup strategy**: Plan for configuration backup and disaster recovery
6. **Security scanning**: Regular vulnerability assessments
7. **Performance tuning**: Monitor and optimize based on usage patterns

## Environment-Specific Deployments

### Development
```bash
kubectl apply -f k8s/ -n development
```

### Staging
```bash
kubectl apply -f k8s/ -n staging
```

### Production
```bash
kubectl apply -f k8s/ -n production
```

Consider using tools like Kustomize or Helm for environment-specific configurations.
