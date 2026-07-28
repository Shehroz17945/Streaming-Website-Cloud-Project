# StreamVault — Configuration Reference

This file lists every resource name, IP, and setting used in the project, along with file/folder locations, so you can look everything up later.

---

## Folder Structure (as it exists on the VMs)

```
StreamVault-Project/
├── frontend/                      → Copy to Frontend VM: /var/www/html/
│   ├── index.html                 → Login page (HTML+CSS combined)
│   ├── script.js                  → Login logic + redirect
│   └── videos.html                → Video list + player (HTML+CSS+JS combined)
│
├── backend/                       → Copy to Backend VM: ~/backend/
│   ├── server.js                  → Main Express server (login, videos, streaming)
│   ├── package.json               → npm dependency list
│   ├── .env                       → Secrets (DB, JWT, storage) — add your real key
│   ├── db-setup.sql               → users table + sample logins
│   └── backend.service            → systemd auto-restart config
│
└── config-reference/
    └── CONFIGURATION.md           → This file
```

---

## Resource Group
| Setting | Value |
|---|---|
| Resource Group | `project1` |

---

## Virtual Networks (VNets)

| VNet Name | Purpose | Region | Address Range |
|---|---|---|---|
| `Vnet-hub` | Application Gateway + vm-router | East US | — |
| `vnet-frontend` | Frontend VM | Central US | `10.0.0.0/24` (VM: `10.0.0.4`) |
| `vnet-backend` | Backend VM | West US 2 | `11.0.0.0/24` (VM: `11.0.0.4`) |
| `vnet-database` | SQL + Storage private endpoints | Canada Central | `192.168.0.0/24` (endpoint: `192.168.0.4`) |

All three spoke VNets are peered with `Vnet-hub` (hub-and-spoke model).

---

## vm-router (NVA)

| Setting | Value |
|---|---|
| Location | `Vnet-hub` |
| Purpose | Forwards traffic between vnet-backend ↔ vnet-database (since they aren't directly peered) |
| IP Forwarding | Enabled on the NIC (Azure setting) + at the OS level (`net.ipv4.ip_forward=1`) |

**Route Table** (attached to `subnet-database`):
- Destination: `11.0.0.0/24` (backend range)
- Next Hop Type: Virtual Appliance
- Next Hop IP: vm-router's private IP

---

## Virtual Machines

| VM Name | Role | OS | Private IP | Software |
|---|---|---|---|---|
| `vm-frontend` | Frontend | Ubuntu 22.04 | `10.0.0.4` | Nginx |
| `vm-backend` | Backend | Ubuntu 22.04 | `11.0.0.4` | Node.js 20 + systemd service |
| `vm-router` | NVA / Router | Ubuntu 22.04 | (hub range) | IP forwarding only |

---

## Azure SQL Database

| Setting | Value |
|---|---|
| Server Name | `videoplatform-sqlserver.database.windows.net` |
| Database Name | `videoplatform-db` |
| Admin Username | `admin11` |
| Access | Private Endpoint only (public access disabled) |
| Table | `users` (id, username, password_hash, created_at) |

---

## Azure Blob Storage

| Setting | Value |
|---|---|
| Storage Account | `videoplatformstorage123` |
| Container | `videos` |
| Access | Private Endpoint only (public access disabled) |
| Access method | Backend proxies/streams videos via `/api/stream/:filename` (no public SAS URLs) |

---

## Application Gateway

| Setting | Value |
|---|---|
| Name | `app-hub` |
| SKU | Standard_v2 / WAF_v2 |
| Public IP resource | `app-gw-ip` |
| DNS Label | `streamvault` |
| Public URL | `http://streamvault.eastus.cloudapp.azure.com` |
| Listener | HTTP, Port 80 |

**Backend Pools:**
| Pool Name | Target |
|---|---|
| `pool-frontend` | `10.0.0.4` |
| `pool-backend` | `11.0.0.4` |

**HTTP Settings:**
| Name | Port | Custom Probe |
|---|---|---|
| `http-setting-frontend` | 80 | Default |
| `http-setting-backend` | 5000 | `probe-backend` |

**Health Probe:**
| Name | Path | Backend Setting |
|---|---|---|
| `probe-backend` | `/health` | `http-setting-backend` |

**Routing Rule:**
- `/api/*` → `pool-backend` + `http-setting-backend`
- Everything else (default) → `pool-frontend` + `http-setting-frontend`

---

## Application Gateway Start/Stop (Azure CLI)

```bash
# Log in first
az login

# Stop (saves cost when not in use)
az network application-gateway stop --name app-hub --resource-group project1

# Start
az network application-gateway start --name app-hub --resource-group project1

# Check status
az network application-gateway show --name app-hub --resource-group project1 --query "operationalState" --output tsv
```

---

## Test Login Credentials

| Username | Password |
|---|---|
| `demo_user` | `Test@123` |
| `Muhammad Usman` | `Abcd123` |
| `shehroz` | `abcd123` |
| `ayesha_khan` | `MyPass456` |

---

## Backend VM — Useful Commands

```bash
# Check service status
sudo systemctl status backend.service

# View live logs
sudo journalctl -u backend.service -f

# Restart after code changes
sudo systemctl restart backend.service

# Test the health endpoint
curl http://localhost:5000/health

# Test login
curl -X POST http://localhost:5000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo_user","password":"Test@123"}'

# Test SQL connectivity
nc -zv videoplatform-sqlserver.database.windows.net 1433
nslookup videoplatform-sqlserver.database.windows.net
```

---

## Frontend VM — Useful Commands

```bash
# Restart Nginx after changing files
sudo systemctl restart nginx

# Check Nginx status
sudo systemctl status nginx

# File locations
/var/www/html/index.html
/var/www/html/script.js
/var/www/html/videos.html
```

---

## Deployment Checklist (fresh setup from these files)

1. Copy the `frontend/*` files to the Frontend VM's `/var/www/html/`
2. Copy the `backend/*` files to the Backend VM's `~/backend/`
3. Edit `backend/.env` — fill in the real `AZURE_STORAGE_ACCOUNT_KEY`
4. On the Backend VM: `cd ~/backend && npm install`
5. Set up `backend.service` as a systemd service (see instructions inside that file)
6. Run `db-setup.sql` against Azure SQL to create the `users` table and sample logins
7. Confirm Private Endpoints + DNS zone links exist for both SQL and Storage
8. Confirm `vm-router` is running with IP forwarding enabled
9. Confirm the Application Gateway's backend pools point to the correct private IPs
10. Test end-to-end: open the Application Gateway's public DNS name, log in, and play a video
