require("dotenv").config();
const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
} = require("@azure/storage-blob");

const app = express();
app.use(cors());
app.use(express.json());

// Used by Application Gateway's health probe
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ---------- Azure SQL connection ----------
const dbConfig = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,
    trustServerCertificate: false,
  },
};

let poolPromise = sql.connect(dbConfig)
  .then((pool) => {
    console.log("Connected to Azure SQL.");
    return pool;
  })
  .catch((err) => {
    console.error("Azure SQL connection error:", err.message);
    process.exit(1);
  });

// ---------- Auth middleware (reads token from the header) ----------
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided. Please log in first." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Token is invalid or has expired." });
    }
    req.user = decoded;
    next();
  });
}

// ---------- POST /api/login ----------
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("username", sql.NVarChar, username)
      .query("SELECT id, username, password_hash FROM users WHERE username = @username");

    const user = result.recordset[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
    );

    return res.json({ message: "Login successful.", token });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({ message: "Server error, please try again." });
  }
});

// ---------- GET /api/videos (protected) ----------
app.get("/api/videos", verifyToken, async (req, res) => {
  try {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const containerName = process.env.AZURE_STORAGE_CONTAINER;

    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    );
    const containerClient = blobServiceClient.getContainerClient(containerName);

    const videos = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      videos.push({
        name: blob.name,
        url: `/api/stream/${encodeURIComponent(blob.name)}`,
      });
    }

    return res.json({ videos });
  } catch (err) {
    console.error("Videos fetch error:", err.message);
    return res.status(500).json({ message: "Could not load videos." });
  }
});

// ---------- GET /api/stream/:filename (token read from query param, for <video> tag) ----------
app.get("/api/stream/:filename", (req, res, next) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ message: "No token provided." });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: "Token is invalid or has expired." });
    }
    req.user = decoded;
    next();
  });
}, async (req, res) => {
  try {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const containerName = process.env.AZURE_STORAGE_CONTAINER;

    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    );
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(req.params.filename);

    const properties = await blobClient.getProperties();
    const fileSize = properties.contentLength;
    const range = req.headers.range;

    if (range) {
      // Supports partial content (206) so the video player can seek/scrub
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const downloadResponse = await blobClient.download(start, chunkSize);

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Type", properties.contentType || "video/mp4");

      downloadResponse.readableStreamBody.pipe(res);
    } else {
      const downloadResponse = await blobClient.download();
      res.setHeader("Content-Type", properties.contentType || "video/mp4");
      res.setHeader("Content-Length", fileSize);
      res.setHeader("Accept-Ranges", "bytes");
      downloadResponse.readableStreamBody.pipe(res);
    }
  } catch (err) {
    console.error("Stream error:", err.message);
    res.status(404).json({ message: "Video not found." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server is running at http://localhost:${PORT}`);
});
