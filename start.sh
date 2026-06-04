#!/bin/bash

echo "🚀 Step 1: Khởi động tầng Hạ tầng..."
docker compose up -d postgres redis zookeeper kafka elasticsearch clickhouse

echo "⏳ Chờ 30 giây cho các database ổn định..."
sleep 30

echo "🚀 Step 2: Khởi động Monitoring..."
docker compose up -d prometheus grafana jaeger

echo "⏳ Chờ thêm 10 giây..."
sleep 10

echo "🚀 Step 3: Bật toàn bộ Microservices và Web..."
docker compose up -d

echo "📊 Kiểm tra trạng thái:"
docker compose ps
echo "✅ HỆ THỐNG ĐÃ SẴN SÀNG!"
