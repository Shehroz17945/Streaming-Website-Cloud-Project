# StreamVault

A secure video streaming platform deployed entirely on Microsoft Azure, built around a hub-and-spoke network architecture where the database and video storage are never exposed to the public internet — all traffic passes through a single, WAF-protected entry point.

## Overview

Users log in with a username and password, and after successful authentication are shown a list of videos they can stream directly in the browser. The project demonstrates a production-style secure deployment pattern rather than just a simple app — private networking, custom routing, JWT-based auth, and backend-proxied video streaming.

## Architecture

```
User Browser
     |
     v
Application Gateway (public entry point + WAF)
     |-- normal pages     -> Frontend VM (Nginx)
     |-- /api/* requests  -> Backend VM (Node.js)
                                 |
                                 |-- vm-router (routes traffic to the database VNet)
                                 |-- Azure SQL Database   (Private Endpoint)
                                 |-- Azure Blob Storage    (Private Endpoint)
```

- **Hub-and-spoke VNets**: separate networks for frontend, backend, and database, all peered through a central hub.
- **No direct public access** to the database or storage — both use Private Endpoints.
- **Custom routing (NVA)**: since the backend and database VNets aren't directly peered, a small router VM forwards traffic between them.
- **Single public entry point**: Application Gateway with a Web Application Firewall (WAF) fronts the entire application; the VMs themselves have no public IP.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript, served by Nginx |
| Backend | Node.js, Express.js |
| Database | Azure SQL Database |
| Storage | Azure Blob Storage |
| Auth | JWT (JSON Web Tokens) + bcrypt password hashing |
| Networking/Infra | Azure VNets, VNet Peering, Route Tables, NSGs, Application Gateway, WAF |

## Features

- Secure login with hashed passwords (bcrypt) and signed JWT tokens
- Video list fetched from private Blob Storage and streamed through the backend (no public storage URLs)
- Range-request support for smooth seeking/scrubbing on large video files
- Path-based routing at the Application Gateway (`/api/*` → backend, everything else → frontend)
- Backend auto-restarts via a systemd service
- Health probe endpoint (`/health`) for Application Gateway monitoring

## Project Structure

```
frontend/
  index.html      # Login page
  script.js       # Login logic
  videos.html     # Video list + player

backend/
  server.js         # Express API (login, videos, streaming)
  package.json
  .env              # Environment variables (not committed)
  db-setup.sql      # Database schema + sample users
  backend.service   # systemd service definition

config-reference/
  CONFIGURATION.md  # Full list of resource names, IPs, and settings
```

## Setup

1. Provision the Azure resources (VNets, VMs, SQL, Storage, Application Gateway) as described in `config-reference/CONFIGURATION.md`.
2. Deploy `frontend/` files to the frontend VM's web root.
3. Deploy `backend/` files to the backend VM, fill in `.env` with real credentials, then run:

   ```bash
   npm install
   npm start
   ```

4. Run `db-setup.sql` against the Azure SQL database to create the `users` table.
5. Set up `backend.service` as a systemd service for auto-restart.
6. Point the Application Gateway's backend pools to the frontend and backend VMs' private IPs.

## Security Notes

- Passwords are never stored in plain text (bcrypt hashing only).
- Database and Storage are only reachable via Private Endpoints — public network access is disabled.
- Videos are streamed through the backend rather than via public SAS URLs, so the storage account stays fully private.
- All public traffic passes through a single Application Gateway protected by a WAF policy.
