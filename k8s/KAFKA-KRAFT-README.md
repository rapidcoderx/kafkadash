# Kafka KRaft Deployment Guide

This guide provides instructions for deploying Apache Kafka in KRaft mode (without Zookeeper) on Kubernetes using a single comprehensive YAML file.

## Overview

The `kafka-kraft-complete.yaml` file contains a complete Kafka deployment with:

- **KRaft Mode**: No Zookeeper dependency
- **Single Broker**: Configured for development/testing
- **Persistent Storage**: 10GB for data, 5GB for logs
- **Kafka UI**: Web-based management interface
- **Security**: NetworkPolicy and proper security contexts
- **Monitoring**: JMX metrics exposure
- **Auto-scaling**: HPA for Kafka UI

## Quick Start

### 1. Deploy Kafka Cluster

```bash
# Deploy the complete Kafka cluster
kubectl apply -f k8s/kafka-kraft-complete.yaml

# Wait for all pods to be ready
kubectl wait --for=condition=ready pod -l app=kafka -n kafka --timeout=300s
```

### 2. Verify Deployment

```bash
# Check all resources in the kafka namespace
kubectl get all -n kafka

# Check Kafka logs
kubectl logs -f statefulset/kafka -n kafka

# Check if Kafka is responding
kubectl exec -it kafka-0 -n kafka -- kafka-topics.sh --list --bootstrap-server localhost:9092
```

### 3. Access Kafka UI (Optional)

```bash
# Port forward to access Kafka UI
kubectl port-forward svc/kafka-ui-service 8080:8080 -n kafka

# Open browser to http://localhost:8080
```

## Configuration

### Storage Classes

Update the `storageClassName` in PersistentVolumeClaims based on your cluster:

```yaml
# For GKE
storageClassName: standard-rwo

# For EKS
storageClassName: gp2

# For AKS
storageClassName: default

# For local development
storageClassName: hostpath
```

### Scaling Configuration

#### Single Node (Current)
- 1 Kafka broker
- Replication factor: 1
- Suitable for development/testing

#### Multi-Node Cluster
To scale to multiple brokers, update:

```yaml
# In StatefulSet
spec:
  replicas: 3

# In ConfigMap server.properties
default.replication.factor=3
min.insync.replicas=2
offsets.topic.replication.factor=3
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2

# Update controller.quorum.voters for all brokers
controller.quorum.voters=1@kafka-0.kafka-headless.kafka.svc.cluster.local:9093,2@kafka-1.kafka-headless.kafka.svc.cluster.local:9093,3@kafka-2.kafka-headless.kafka.svc.cluster.local:9093
```

### External Access

#### LoadBalancer (Default)
- Service type: LoadBalancer
- Automatic external IP assignment
- Port: 9094

#### NodePort
```yaml
# Change service type to NodePort
spec:
  type: NodePort
  ports:
    - name: kafka-external
      port: 9094
      targetPort: 9094
      nodePort: 30094
```

#### Ingress (Recommended for Production)
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kafka-ingress
  namespace: kafka
spec:
  rules:
    - host: kafka.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kafka-service
                port:
                  number: 9092
```

## Testing the Deployment

### 1. Create a Test Topic

```bash
kubectl exec -it kafka-0 -n kafka -- kafka-topics.sh \
  --create \
  --topic test-topic \
  --bootstrap-server localhost:9092 \
  --partitions 3 \
  --replication-factor 1
```

### 2. Produce Messages

```bash
kubectl exec -it kafka-0 -n kafka -- kafka-console-producer.sh \
  --topic test-topic \
  --bootstrap-server localhost:9092
```

### 3. Consume Messages

```bash
# In another terminal
kubectl exec -it kafka-0 -n kafka -- kafka-console-consumer.sh \
  --topic test-topic \
  --bootstrap-server localhost:9092 \
  --from-beginning
```

### 4. Check Topic Details

```bash
kubectl exec -it kafka-0 -n kafka -- kafka-topics.sh \
  --describe \
  --topic test-topic \
  --bootstrap-server localhost:9092
```

## Monitoring and Troubleshooting

### Health Checks

```bash
# Check pod status
kubectl get pods -n kafka

# Check service endpoints
kubectl get endpoints -n kafka

# Check persistent volumes
kubectl get pv,pvc -n kafka
```

### Logs

```bash
# Kafka broker logs
kubectl logs -f kafka-0 -n kafka

# Kafka UI logs
kubectl logs -f deployment/kafka-ui -n kafka

# Check events
kubectl get events -n kafka --sort-by=.metadata.creationTimestamp
```

### JMX Metrics

Connect to JMX port 9999 for monitoring:

```bash
# Port forward JMX port
kubectl port-forward kafka-0 9999:9999 -n kafka

# Use JConsole or other JMX tools to connect to localhost:9999
```

### Performance Tuning

For production workloads, consider adjusting:

```yaml
# In server.properties
num.network.threads=8
num.io.threads=16
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
num.partitions=6
default.replication.factor=3

# In container resources
resources:
  requests:
    memory: "4Gi"
    cpu: "2000m"
  limits:
    memory: "8Gi"
    cpu: "4000m"

# Heap size
env:
  - name: KAFKA_HEAP_OPTS
    value: "-Xmx4G -Xms4G"
```

## Security Considerations

### Network Security
- NetworkPolicy restricts traffic to necessary ports only
- Consider using TLS/SSL for production deployments

### Authentication and Authorization
For production, enable SASL/SCRAM or mTLS:

```yaml
# Add to server.properties
sasl.enabled.mechanisms=SCRAM-SHA-256
sasl.mechanism.inter.broker.protocol=SCRAM-SHA-256
security.inter.broker.protocol=SASL_PLAINTEXT
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:SASL_PLAINTEXT,EXTERNAL:SASL_PLAINTEXT

# Create users
authorizer.class.name=kafka.security.authorizer.AclAuthorizer
super.users=User:admin
```

### Storage Security
- Use encrypted storage classes
- Implement backup strategies for persistent volumes

## Backup and Recovery

### Data Backup
```bash
# Create backup of Kafka data
kubectl exec kafka-0 -n kafka -- tar -czf /tmp/kafka-backup.tar.gz /var/kafka-logs

# Copy backup locally
kubectl cp kafka-0:/tmp/kafka-backup.tar.gz ./kafka-backup.tar.gz -n kafka
```

### Configuration Backup
```bash
# Backup configurations
kubectl get configmap kafka-config -n kafka -o yaml > kafka-config-backup.yaml
kubectl get secret -n kafka -o yaml > kafka-secrets-backup.yaml
```

## Cleanup

```bash
# Delete the entire Kafka deployment
kubectl delete -f k8s/kafka-kraft-complete.yaml

# Delete persistent volumes (if needed)
kubectl delete pvc --all -n kafka

# Delete namespace
kubectl delete namespace kafka
```

## Integration with Applications

### Connection String
```
Bootstrap Servers: kafka-service.kafka.svc.cluster.local:9092
```

### From Same Namespace
```
Bootstrap Servers: kafka-service:9092
```

### External Applications
Use the LoadBalancer service or Ingress endpoint configured for your cluster.

## Production Checklist

- [ ] Configure appropriate resource limits
- [ ] Set up monitoring and alerting
- [ ] Enable TLS/SSL encryption
- [ ] Configure authentication and authorization
- [ ] Set up regular backups
- [ ] Configure log retention policies
- [ ] Test disaster recovery procedures
- [ ] Set up network policies
- [ ] Configure anti-affinity rules for multi-node deployment
- [ ] Set up persistent volume backup strategy
