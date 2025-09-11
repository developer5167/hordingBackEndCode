// deps.js  (CommonJS)
const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");
const consoleLog = console.log;
const http = require("http");
const cors = require("cors");
const auth = require("./middleware/auth");

// app-specific modules that already export objects
const db = require("./db");                 // Postgres client instance
const { admin, fcm } = require("./firebaseAdmin"); // firebase admin, fcm

// prepare commonly used instances
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// helper factory for createRequire if you ever need to import CJS inside ESM files
const { createRequire } = require && require("module") ? require("module") : { createRequire: null };

// export everything in one place
module.exports = {
  express,
  multer,
  upload,
  uuidv4,
  jwt,
  bcrypt,
  nodemailer,
  path,
  crypto,
  consoleLog,
  http,
  cors,
  db,
  client: db,        // many files reference `client`
  admin,
  fcm,
  auth,
  createRequire
};
