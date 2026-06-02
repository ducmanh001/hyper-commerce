# ==============================================================
# HYPERCOMMERCE — Developer Makefile
# Usage: make <target>
# ==============================================================

.PHONY: help dev dev-infra dev-services stop logs clean build test lint typecheck \
        migrate seeds create-topics k8s-apply tf-plan tf-apply

# ── Colors ─────────────────────────────────────────────────────
CYAN    := \033[36m
RESET   := \033[0m
BOLD    := \033[1m

help: ## Show this help
	@echo "$(BOLD)HYPERCOMMERCE — Available commands:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-25s$(RESET) %s\n", $$1, $$2}'

# ── Local Development ──────────────────────────────────────────
dev-infra: ## Start infrastructure (postgres, redis, kafka, elasticsearch, clickhouse)
	docker compose up -d postgres pgbouncer redis zookeeper kafka elasticsearch clickhouse
	@echo "Waiting for services to be healthy..."
	@sleep 10
	@$(MAKE) create-topics
	@echo "$(CYAN)✓ Infrastructure ready$(RESET)"

up: ## Single-command: build and start ALL services (infra + microservices + web) in Docker
	docker compose up -d --build
	@echo "$(CYAN)✓ All services started$(RESET)"
	@echo "  Web:          http://localhost:3000"
	@echo "  Grafana:      http://localhost:3100"
	@echo "  Kafka UI:     http://localhost:8080"
	@echo "  Jaeger:       http://localhost:16686"

up-infra: ## Start infra only in Docker, then run microservices locally
	@$(MAKE) dev-infra
	@echo "$(CYAN)Run 'make dev-local' in another terminal$(RESET)"

dev-local: ## Run all microservices locally (requires infra up via 'make up-infra')
	@echo "Starting all microservices locally..."
	USER_PORT=3005 node dist/apps/user-service/src/main.js &
	ORDER_PORT=3011 node dist/apps/order-service/src/main.js &
	PAYMENT_PORT=3003 node dist/apps/payment-service/src/main.js &
	INVENTORY_PORT=3002 node dist/apps/inventory-service/src/main.js &
	NOTIFICATION_PORT=3004 node dist/apps/notification-service/src/main.js &
	SEARCH_PORT=3010 node dist/apps/search-service/src/main.js &
	AI_PORT=3006 node dist/apps/ai-service/src/main.js &
	LIVE_PORT=3007 node dist/apps/live-service/src/main.js &
	FEED_PORT=3008 node dist/apps/feed-service/src/main.js &
	ANALYTICS_PORT=3009 node dist/apps/analytics-service/src/main.js &
	cd apps/web && npm run dev
	@echo "$(CYAN)✓ All services running$(RESET)"

dev: dev-infra ## Start all services in dev mode (watch)
	npm run start:dev

dev-service: ## Start a specific service: make dev-service SERVICE=order-service
	npm run start:dev -- $(SERVICE)

stop: ## Stop all Docker services
	docker compose down

stop-clean: ## Stop all Docker services and remove volumes
	docker compose down -v
	@echo "$(CYAN)✓ All volumes removed$(RESET)"

logs: ## Tail logs for all services
	docker compose logs -f

logs-service: ## Tail logs for a specific service: make logs-service SERVICE=order-service
	docker compose logs -f $(SERVICE)

# ── Build ──────────────────────────────────────────────────────
build: ## Build all services for production
	npm run build

build-service: ## Build a specific service: make build-service SERVICE=order-service
	npm run build -- $(SERVICE)

build-docker: ## Build Docker images for all services
	@for SERVICE in order-service payment-service inventory-service user-service \
		notification-service search-service ai-service live-service feed-service analytics-service; do \
		echo "Building $$SERVICE..."; \
		docker build -f apps/$$SERVICE/Dockerfile \
			--build-arg SERVICE=$$SERVICE \
			-t hypercommerce/$$SERVICE:local .; \
	done

# ── Testing ────────────────────────────────────────────────────
test: ## Run all unit tests
	npm run test

test-watch: ## Run tests in watch mode
	npm run test:watch

test-e2e: ## Run e2e tests
	npm run test:e2e

test-coverage: ## Run tests with coverage
	npm run test:cov

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint with auto-fix
	npm run lint -- --fix

typecheck: ## TypeScript type check (no emit)
	npx tsc --noEmit

# ── Database ───────────────────────────────────────────────────
migrate: ## Run database migrations
	npm run migration:run

migrate-generate: ## Generate a new migration: make migrate-generate NAME=AddUserTable
	npm run migration:generate -- $(NAME)

migrate-revert: ## Revert the last migration
	npm run migration:revert

seeds: ## Seed development data
	npm run db:seed

# ── Kafka ──────────────────────────────────────────────────────
create-topics: ## Create Kafka topics
	@echo "Creating Kafka topics..."
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 6 --replication-factor 1 \
		--topic order.events
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 6 --replication-factor 1 \
		--topic payment.events
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 6 --replication-factor 1 \
		--topic inventory.events
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 6 --replication-factor 1 \
		--topic user.events
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 12 --replication-factor 1 \
		--topic notification.dispatch
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 3 --replication-factor 1 \
		--topic search.events
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 6 --replication-factor 1 \
		--topic live.events
	@docker compose exec -T kafka kafka-topics --bootstrap-server localhost:9092 \
		--create --if-not-exists --partitions 6 --replication-factor 1 \
		--topic analytics.events
	@echo "$(CYAN)✓ Kafka topics created$(RESET)"

list-topics: ## List Kafka topics
	docker compose exec kafka kafka-topics --bootstrap-server localhost:9092 --list

# ── Kubernetes ─────────────────────────────────────────────────
k8s-apply: ## Apply all Kubernetes manifests
	kubectl apply -f infrastructure/kubernetes/ -R

k8s-apply-service: ## Apply K8s manifest for a specific service: make k8s-apply-service SERVICE=order-service
	kubectl apply -f infrastructure/kubernetes/services/$(SERVICE).yaml

k8s-status: ## Check pod status
	kubectl get pods -n hypercommerce -o wide

k8s-logs: ## Get logs from a service: make k8s-logs SERVICE=order-service
	kubectl logs -l app=$(SERVICE) -n hypercommerce --tail=100 -f

k8s-rollback: ## Rollback a service: make k8s-rollback SERVICE=order-service
	kubectl rollout undo deployment/$(SERVICE) -n hypercommerce

# ── Terraform ──────────────────────────────────────────────────
tf-init: ## Terraform init
	cd infrastructure/terraform && terraform init

tf-plan: ## Terraform plan (dry run)
	cd infrastructure/terraform && terraform plan \
		-var="db_password=$$DB_PASSWORD" \
		-var="redis_auth_token=$$REDIS_AUTH_TOKEN"

tf-apply: ## Terraform apply (deploy infrastructure)
	cd infrastructure/terraform && terraform apply \
		-var="db_password=$$DB_PASSWORD" \
		-var="redis_auth_token=$$REDIS_AUTH_TOKEN" \
		-auto-approve

tf-destroy: ## Terraform destroy (DESTRUCTIVE)
	cd infrastructure/terraform && terraform destroy \
		-var="db_password=$$DB_PASSWORD" \
		-var="redis_auth_token=$$REDIS_AUTH_TOKEN"

# ── Monitoring ─────────────────────────────────────────────────
monitoring: ## Start monitoring stack (prometheus + grafana)
	docker compose up -d prometheus grafana jaeger
	@echo "$(CYAN)Grafana: http://localhost:3000 (admin/admin_secret)$(RESET)"
	@echo "$(CYAN)Prometheus: http://localhost:9090$(RESET)"
	@echo "$(CYAN)Jaeger: http://localhost:16686$(RESET)"

# ── Utilities ──────────────────────────────────────────────────
clean: ## Remove build artifacts
	rm -rf dist
	find . -name "*.js.map" -delete

install: ## Install npm dependencies
	npm install --legacy-peer-deps

update: ## Update npm dependencies
	npx npm-check-updates -u
	npm install --legacy-peer-deps
