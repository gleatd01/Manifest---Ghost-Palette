#!/bin/bash
kill $(lsof -t -i :3000) 2>/dev/null || true
kill $(lsof -t -i :5173) 2>/dev/null || true
sudo su - postgres -c "/usr/lib/postgresql/16/bin/postgres -D /etc/postgresql/16/main &"
cat << 'ENVA' > .env
DATABASE_URL=postgres://jules:jules@localhost:5432/ghost_db
POSTGRES_USER=jules
POSTGRES_HOST=localhost
POSTGRES_DB=ghost_db
POSTGRES_PASSWORD=jules
POSTGRES_PORT=5432
ENVA
npm run dev > logs.txt 2>&1 &
echo "Started"
