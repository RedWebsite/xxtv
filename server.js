// Vercel 环境会自动注入环境变量，无需加载 .env 文件
if (!process.env.VERCEL) {
    require('dotenv').config();
}

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ 修复：使用 process.cwd() 确保在 Vercel 中路径正确
const DATA_FILE = path.join(process.cwd(), 'db.json');
const TEMPLATE_FILE = path.join(process.cwd(), 'db.template.json');

// 自动识别环境并切换到可写目录
const IS_VERCEL = !!process.env.VERCEL;
const CACHE_DIR = IS_VERCEL ? '/tmp' : __dirname;

const SEARCH_CACHE_JSON = path.join(CACHE_DIR, 'cache_search.json');
const DETAIL_CACHE_JSON = path.join(CACHE_DIR, 'cache_detail.json');
// 初始化目录
if (!fs.existsSync(IMAGE_CACHE_DIR)) {
    try { fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true }); } catch(e){}
}

// 访问密码配置
const ACCESS_PASSWORD_RAW = process.env.ACCESS_PASSWORD || '';
const ACCESS_PASSWORDS = ACCESS_PASSWORD_RAW ? ACCESS_PASSWORD_RAW.split(',').map(p => p.trim()).filter(p => p) : [];

const PASSWORD_HASH_MAP = {};
ACCESS_PASSWORDS.forEach((pwd, index) => {
    const hash = crypto.createHash('sha256').update(pwd).digest('hex');
    PASSWORD_HASH_MAP[hash] = { index: index, syncEnabled: index > 0 };
});

// 缓存管理类
class CacheManager {
    constructor(type) {
        this.type = type;
        this.searchCache = {};
        this.detailCache = {};
        this.init();
    }

    init() {
        // 在 Vercel 中，即使配置为 json，也从 /tmp 加载
        if (this.type === 'json' || IS_VERCEL) {
            if (fs.existsSync(SEARCH_CACHE_JSON)) {
                try { this.searchCache = JSON.parse(fs.readFileSync(SEARCH_CACHE_JSON)); } catch (e) { }
            }
            if (fs.existsSync(DETAIL_CACHE_JSON)) {
                try { this.detailCache = JSON.parse(fs.readFileSync(DETAIL_CACHE_JSON)); } catch (e) { }
            }
        }
    }

    get(category, key) {
        const data = category === 'search' ? this.searchCache[key] : this.detailCache[key];
        if (data && data.expire > Date.now()) return data.value;
        return null;
    }

    set(category, key, value, ttlSeconds = 600) {
        const expire = Date.now() + ttlSeconds * 1000;
        const item = { value, expire };
        if (category === 'search') this.searchCache[key] = item;
        else this.detailCache[key] = item;
        
        // 异步写入 /tmp，防止阻塞
        try {
            if (category === 'search') fs.writeFileSync(SEARCH_CACHE_JSON, JSON.stringify(this.searchCache));
