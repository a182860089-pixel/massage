#!/usr/bin/env node
/**
 * 远程命令/SFTP 一次性入口。
 *
 * 用法：
 *   node scripts/remote-runner.mjs exec "uname -a"
 *   node scripts/remote-runner.mjs exec-file scripts/remote-survey.sh
 *   node scripts/remote-runner.mjs download /tmp/foo.tar.gz artifacts/foo.tar.gz
 *   node scripts/remote-runner.mjs upload   cardkey-server/dist /opt/cardkey-only
 *
 * 凭据读取顺序：
 *   1) 环境变量 REMOTE_HOST/REMOTE_USER/REMOTE_PASS/REMOTE_PORT
 *   2) scripts/.remote-credentials.json（gitignore 已加）
 *
 * 所有调用都会在 artifacts/remote-runner.log 追加一行结构化日志。
 */

import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const credPath = path.join(__dirname, '.remote-credentials.json');

async function loadCredentials() {
  const envCreds = {
    host: process.env.REMOTE_HOST,
    username: process.env.REMOTE_USER,
    password: process.env.REMOTE_PASS,
    port: process.env.REMOTE_PORT ? Number(process.env.REMOTE_PORT) : 22
  };
  if (envCreds.host && envCreds.username && envCreds.password) {
    return envCreds;
  }
  try {
    const raw = await fs.readFile(credPath, 'utf8');
    const json = JSON.parse(raw);
    return {
      host: json.host,
      username: json.username || 'root',
      password: json.password,
      port: Number(json.port || 22)
    };
  } catch (error) {
    throw new Error(
      `未找到 SSH 凭据：请设置环境变量 REMOTE_HOST/REMOTE_USER/REMOTE_PASS 或创建 ${credPath}`
    );
  }
}

async function appendLog(line) {
  const dir = path.join(projectRoot, 'artifacts');
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString();
  await fs.appendFile(path.join(dir, 'remote-runner.log'), `[${stamp}] ${line}\n`, 'utf8');
}

function execOnce(creds, command, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`exec timeout after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    conn
      .on('ready', () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            return reject(err);
          }
          stream
            .on('close', (code, signal) => {
              clearTimeout(timer);
              conn.end();
              resolve({ code, signal, stdout, stderr });
            })
            .on('data', (data) => {
              stdout += data.toString('utf8');
            });
          stream.stderr.on('data', (data) => {
            stderr += data.toString('utf8');
          });
        });
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect({
        host: creds.host,
        port: creds.port || 22,
        username: creds.username,
        password: creds.password,
        readyTimeout: 20000,
        keepaliveInterval: 15000
      });
  });
}

async function cmdExec(args) {
  if (args.length === 0) throw new Error('exec 需要命令字符串');
  const command = args.join(' ');
  const creds = await loadCredentials();
  await appendLog(`exec: ${command}`);
  const { code, signal, stdout, stderr } = await execOnce(creds, command, {
    timeoutMs: Number(process.env.REMOTE_TIMEOUT_MS || 120000)
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  await appendLog(`exit_code=${code} signal=${signal || ''} stdout_bytes=${stdout.length} stderr_bytes=${stderr.length}`);
  process.exitCode = code || 0;
}

async function cmdExecFile(args) {
  if (args.length === 0) throw new Error('exec-file 需要本地脚本路径');
  const localPath = path.resolve(projectRoot, args[0]);
  const raw = await fs.readFile(localPath, 'utf8');
  const script = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const creds = await loadCredentials();
  await appendLog(`exec-file: ${localPath} (${script.length} bytes)`);
  const command = `bash -s <<'__SCRIPT_END__'\n${script}\n__SCRIPT_END__\n`;
  const { code, signal, stdout, stderr } = await execOnce(creds, command, {
    timeoutMs: Number(process.env.REMOTE_TIMEOUT_MS || 180000)
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  await appendLog(`exit_code=${code} signal=${signal || ''} stdout_bytes=${stdout.length} stderr_bytes=${stderr.length}`);
  process.exitCode = code || 0;
}

async function cmdDownload(args) {
  if (args.length < 2) throw new Error('download 需要 远端路径 本地路径');
  const remotePath = args[0];
  const localPath = path.resolve(projectRoot, args[1]);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  const sftp = new SftpClient();
  const creds = await loadCredentials();
  await appendLog(`download: ${remotePath} -> ${localPath}`);
  await sftp.connect({
    host: creds.host,
    port: creds.port || 22,
    username: creds.username,
    password: creds.password
  });
  try {
    await sftp.fastGet(remotePath, localPath);
    console.log(`downloaded ${remotePath} -> ${localPath}`);
  } finally {
    await sftp.end();
  }
}

async function cmdUpload(args) {
  if (args.length < 2) throw new Error('upload 需要 本地路径 远端路径');
  const localPath = path.resolve(projectRoot, args[0]);
  const remotePath = args[1];
  const sftp = new SftpClient();
  const creds = await loadCredentials();
  await appendLog(`upload: ${localPath} -> ${remotePath}`);
  await sftp.connect({
    host: creds.host,
    port: creds.port || 22,
    username: creds.username,
    password: creds.password
  });
  try {
    const stat = await fs.stat(localPath);
    if (stat.isDirectory()) {
      await sftp.uploadDir(localPath, remotePath);
    } else {
      await sftp.fastPut(localPath, remotePath);
    }
    console.log(`uploaded ${localPath} -> ${remotePath}`);
  } finally {
    await sftp.end();
  }
}

async function main() {
  const [, , sub, ...rest] = process.argv;
  if (!sub) {
    console.error('Usage: remote-runner.mjs <exec|exec-file|download|upload> ...args');
    process.exit(2);
  }
  try {
    if (sub === 'exec') await cmdExec(rest);
    else if (sub === 'exec-file') await cmdExecFile(rest);
    else if (sub === 'download') await cmdDownload(rest);
    else if (sub === 'upload') await cmdUpload(rest);
    else {
      console.error(`未知子命令: ${sub}`);
      process.exit(2);
    }
  } catch (error) {
    await appendLog(`error: ${error.message}`);
    console.error(`[remote-runner] ${error.message}`);
    process.exit(1);
  }
}

main();
