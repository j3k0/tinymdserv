#!/usr/bin/env node

import express from 'express';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { marked } from 'marked';
import * as fs from 'node:fs';
import yargs from 'yargs';
import { createRequire } from 'module';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
const require = createRequire(import.meta.url);
const { version } = require('./package.json');

//////////////////////
// Global variables //
//////////////////////

let docs_path;
let quiet = false;
const AUTH_COOKIE_NAME = 'auth_token';
const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Authentication settings
const USERNAME = process.env.AUTH_USERNAME || 'admin';
const PASSWORD = process.env.AUTH_PASSWORD || 'password';
const SALT = process.env.AUTH_SALT || 'default_salt';

// Generate auth token
function generateAuthToken(username, password) {
    return crypto
        .createHash('sha256')
        .update(`${username}:${password}:${SALT}`)
        .digest('hex');
}

// Authentication middleware
function requireAuth(req, res, next) {
    // Skip auth for login page and its assets
    if (req.path === '/login' || req.path.startsWith('/login/')) {
        return next();
    }

    const authToken = req.cookies[AUTH_COOKIE_NAME];
    const expectedToken = generateAuthToken(USERNAME, PASSWORD);

    if (authToken === expectedToken) {
        next();
    } else {
        res.redirect('/login');
    }
}

///////////////////
// Main function //
///////////////////

function main() {
    // SSL certificate file path.
    const key_path = 'server.key';
    const cert_path = 'server.crt';

    // Check if SSL files exist
    const use_https = fs.existsSync(key_path) && fs.existsSync(cert_path);

    const argv = yargs(process.argv.slice(2))
        .option('port', {
            alias: 'p',
            type: 'number',
            description: 'Set port number',
            default: (use_https ? 443 : 80),
        })
        .option('dir', {
            alias: 'd',
            type: 'string',
            description: 'Set document path',
            default: './docs',
        })
        .option('file', {
            alias: 'f',
            type: 'string',
            description: 'Set document default name',
            default: 'index.md',
        })
        .option('templates', {
            alias: 't',
            type: 'string',
            description: 'Set templates directory path',
            default: './templates',
        })
        .option('quiet', {
            alias: 'q',
            type: 'boolean',
            description: 'Activate quiet mode',
        })
        .help()
        .argv;

    if (yargs.version) {
        console.log(`Version: ${version}`);
        return;
    }

    const app = express();

    // Add cookie parser middleware
    app.use(cookieParser());
    
    // Add body parser for login form
    app.use(express.urlencoded({ extended: true }));

    // Set docs path and quiet mode.
    docs_path = path.resolve(argv.dir);
    quiet = argv.quiet;

    if (!argv.quiet) {
        console.log('Version:', version);
        console.log('Port number:', argv.port);
        console.log('Directory:', docs_path);
        console.log('Default name:', argv.file);
    }

    app.set('views', path.resolve(argv.templates));
    app.set('view engine', 'ejs');

    // Login routes (before auth middleware)
    app.get('/login', (req, res) => {
        res.render('login.ejs', { error: null });
    });

    app.post('/login', (req, res) => {
        const { username, password } = req.body;
        
        if (username === USERNAME && password === PASSWORD) {
            const token = generateAuthToken(username, password);
            res.cookie(AUTH_COOKIE_NAME, token, {
                maxAge: AUTH_COOKIE_MAX_AGE,
                httpOnly: true,
                secure: use_https
            });
            res.redirect('/');
        } else {
            res.render('login.ejs', { error: 'Invalid credentials' });
        }
    });

    // Add logout handler
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE_NAME);
        res.redirect('/login');
    });

    // Add auth middleware for all other routes
    app.use(requireAuth);

    app.get('/', (req, res) => {
        res.redirect(`/search`);
    });

    // Add static middleware for templates directory before other routes
    app.use(express.static(path.resolve(argv.templates)));

    app.get('*.md', doc_handler);

    app.get('*.__datetime__', datetime_handler);

    app.get('/search', search_handler);

    app.get('*.mp4', mp4_handler);

    app.use(express.static(docs_path))

    app.get('*', default_handler);

    // Start server
    if (use_https) {
        // HTTPS server
        https.createServer({
            key: fs.readFileSync(key_path),
            cert: fs.readFileSync(cert_path)
        }, app).listen(argv.port, () => {
            const address = 'https://' + get_ip_address() + (argv.port == 443 ? '' : `:${argv.port}`) + '/';
            if (!argv.quiet)
                console.log(`HTTPS Server started on ${address}`);
        });
    } else {
        // HTTP server
        http.createServer(app).listen(argv.port, () => {
            const address = 'http://' + get_ip_address() + (argv.port == 80 ? '' : `:${argv.port}`) + '/';
            if (!argv.quiet)
                console.log(`HTTP Server started on ${address}`);
        });
    }
};

main();

///////////////////////
// Handler functions //
///////////////////////

const datetime_option = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
};

const escapeMap = {
    '\\': '&#x5C;',
    '<': '&#x3C;',
    '_': '&#x5F;',
    '*': '&#x2A;',
    '`': '&#x60;',
    "'": '&#x27;',
    '"': '&#x22;'
};

const unescapeMap = Object.entries(escapeMap).reduce(
    (acc, [key, value]) => ({ ...acc, [value]: key }),
    {}
);

function escapeMath(text) {
    const regex1 = /((^|(?<=[^\\$]))\$)([^$\n]+?)((?<=[^\\$])\$)/g;
    const regex2 = /((^|(?<=[^\\$]))\$\$)([^$]+?)((?<=[^\\$])\$\$)/g;

    const result = text.replace(regex1, (_match, _del1, _pref, content, _del2) => {
        let escaped = content;
        Object.entries(escapeMap).forEach(([char, replacement]) => {
            escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), replacement);
        });
        return `$${escaped}$`;
    });

    return result.replace(regex2, (_match, _del1, _pref, content, _del2) => {
        let escaped = content;
        Object.entries(escapeMap).forEach(([char, replacement]) => {
            escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), replacement);
        });
        return `$$${escaped}$$`;
    });
}

function unescapeMath(text) {
    const regex1 = /((^|(?<=[^\\$]))\$)([^$\n]+?)((?<=[^\\$])\$)/g;
    const regex2 = /((^|(?<=[^\\$]))\$\$)([^$]+?)((?<=[^\\$])\$\$)/g;

    const result = text.replace(regex1, (_match, _del1, _pref, content, _del2) => {
        let unescaped = content;
        Object.entries(unescapeMap).forEach(([placeholder, char]) => {
            unescaped = unescaped.replace(new RegExp(placeholder, 'g'), char);
        });
        return `$${unescaped}$`;
    });

    return result.replace(regex2, (_match, _del1, _pref, content, _del2) => {
        let unescaped = content;
        Object.entries(unescapeMap).forEach(([placeholder, char]) => {
            unescaped = unescaped.replace(new RegExp(placeholder, 'g'), char);
        });
        return `$$${unescaped}$$`;
    });
}

function doc_handler(req, res) {
    try {
        const req_url = decodeURIComponent(req.url);
        const params = new URL('http://127.0.0.1' + req_url).searchParams;
        const page = params.get('page');
        const file_path = req_url.split('?')[0];

        if (!quiet)
            console.log(`${(new Date()).toLocaleString('en-US', datetime_option)}, ${req.socket.remoteAddress}, ${req_url}`);

        let doc = fs.readFileSync(docs_path + file_path, 'utf8');
        let title = doc.match(/^# .*?(?=\r?\n)/);
        title = title ? title[0].substring(1).trim() : file_path;

        doc = escapeMath(doc);

        marked.use({
            renderer: {
                code({text, lang, escaped}) {
                    if (lang === 'mermaid')
                        return `<div class="text-center"><pre class="mermaid">${text}</pre></div>`;
                    else
                        return `<pre><code class="${lang}">${text}</code></pre>`;
                }
            }
        });

        let content = marked(doc, { "mangle": false, headerIds: false });

        content = unescapeMath(content);

        let dict_params = {};
        params.forEach((value, key) => {
            dict_params[key] = value;
        });

        res.render('template.ejs',
            {
                "title": title,
                "content": content,
                "page": page,
                "params": dict_params
            });
    } catch (error) {
        if (!quiet)
            console.log(error);
        res.status(500).send('Internal error!');
    }
}

function datetime_handler(req, res) {
    try {
        const req_url = decodeURIComponent(req.url);
        const file_path = req_url.substring(0, req_url.length - '.__datetime__'.length);

        fs.stat(docs_path + file_path, function (err, stats) {
            if (err) {
                res.status(400).send('Bad request!');
            } else {
                res.send(stats.mtime.toLocaleString());
            }
        });
    } catch (error) {
        if (!quiet)
            console.log(error);
        res.status(500).send('Internal error!');
    }
}

function search_handler(req, res) {
    try {
        const req_url = decodeURIComponent(req.url);
        const query = new URL('http://127.0.0.1' + req_url).searchParams.get('q');
        let file_list = (query == null) ? [] : search_files(docs_path, query);

        res.render('search.ejs', { "title": query, "content": file_list });
    } catch (error) {
        if (!quiet)
            console.log(error);
        res.status(500).send('Internal error!');
    }
}

function search_files(directory, query) {
    const files_matching = [];
    const prefix_length = directory.length;
    const search_string = query.toLowerCase()

    function search(directory) {
        try {
            const files = fs.readdirSync(directory);

            for (const file of files) {
                const file_path = path.join(directory, file);

                try {
                    // Get file stats (using lstat to detect symlinks)
                    const stats = fs.lstatSync(file_path);

                    // Skip symlinks
                    if (stats.isSymbolicLink()) {
                        continue;
                    }

                    // Skip node_modules directories
                    if (stats.isDirectory()) {
                        if (file === 'node_modules') {
                            continue;
                        }
                        search(file_path);
                    } else {
                        const extension = path.extname(file_path).toLowerCase();

                        if (extension !== '.md' && extension !== '.html') {
                            continue;
                        }

                        const content = fs.readFileSync(file_path, 'utf8').toLowerCase();
                        if (!content.includes(search_string)) {
                            continue;
                        }

                        files_matching.push(file_path.substring(prefix_length).replace(/\\/g, '/'));
                    }
                } catch (error) {
                    // Skip files/directories we can't access
                    if (!quiet) {
                        console.log(`Warning: Could not access ${file_path}: ${error.message}`);
                    }
                    continue;
                }
            }
        } catch (error) {
            // Skip directories we can't read
            if (!quiet) {
                console.log(`Warning: Could not read directory ${directory}: ${error.message}`);
            }
            return;
        }
    }

    search(directory);

    return files_matching;
}

function mp4_handler(req, res) {
    try {
        const req_url = decodeURIComponent(req.url);
        if (!quiet)
            console.log(`${(new Date()).toLocaleString('en-US', datetime_option)}, ${req.socket.remoteAddress}, ${req_url}`);

        const video_path = docs_path + req_url;
        const video_size = fs.statSync(video_path).size;
        const range = req.headers.range;
        const CHUNK_SIZE = 10 ** 6;  // 1MB

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'inline');

        if (range) {
            const [start, end] = range.replace(/bytes=/, '').split('-');
            const start_pos = parseInt(start);
            let end_pos = parseInt(end);
            end_pos = isNaN(end_pos) ? video_size - 1 : end_pos;
            const content_length = end_pos - start_pos + 1;

            res.status(206).header({
                'Content-Range': `bytes ${start_pos}-${end_pos}/${video_size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': content_length,
            });

            const video_stream = fs.createReadStream(video_path, { start: start_pos, end: end_pos });
            video_stream.pipe(res);
        } else {
            res.status(200).header({
                'Content-Length': video_size,
            });

            const video_stream = fs.createReadStream(video_path, { highWaterMark: CHUNK_SIZE });
            video_stream.pipe(res);
        }
    } catch (error) {
        if (!quiet)
            console.log(error);
        res.status(500).send(`Internal error!: ${error}.`);
    }
}

function getMarkdownTitle(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const titleMatch = content.match(/^# (.*?)(?:\r?\n|$)/);
        return titleMatch ? titleMatch[1].trim() : null;
    } catch (error) {
        return null;
    }
}

function default_handler(req, res) {
    const req_url = decodeURIComponent(req.url);
    const postfix = [".md", "index.md", "/index.md"]

    // First try to find markdown files
    for (let i = 0; i < postfix.length; i++) {
        try {
            fs.accessSync(docs_path + req_url + postfix[i], fs.constants.F_OK);
            res.redirect(req_url + postfix[i]);
            return;
        } catch (error) {
        }
    }

    // If no markdown file found, check if it's a directory
    try {
        const fullPath = docs_path + req_url;
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
            const files = fs.readdirSync(fullPath);
            const items = files.map(file => {
                const filePath = path.join(fullPath, file);
                const isDir = fs.statSync(filePath).isDirectory();
                const relativePath = path.join(req_url, file).replace(/\\/g, '/');
                let title = null;
                
                // Get title from markdown files
                if (!isDir && file.toLowerCase().endsWith('.md')) {
                    title = getMarkdownTitle(filePath);
                }

                return {
                    name: file,
                    isDirectory: isDir,
                    path: relativePath,
                    title: title
                };
            });

            // Sort items: directories first, then files
            items.sort((a, b) => {
                if (a.isDirectory === b.isDirectory) {
                    return a.name.localeCompare(b.name);
                }
                return a.isDirectory ? -1 : 1;
            });

            // Generate directory listing content
            let content = `# Directory listing for ${req_url || '/'}\n\n`;
            if (req_url !== '/') {
                content += `- [../ Parent Directory](../)\n`;
            }
            
            items.forEach(item => {
                const displayName = item.name + (item.isDirectory ? '/' : '');
                if (item.title) {
                    // If we have a markdown title, show it in parentheses after the filename
                    content += `- [${item.title}](/${encodeURIComponent(item.path)}) _(${displayName})_\n`;
                } else {
                    content += `- [${displayName}](/${encodeURIComponent(item.path)}${item.isDirectory ? '/' : ''})\n`;
                }
            });

            // Use the existing markdown renderer to display the content
            content = marked(content, { "mangle": false, headerIds: false });
            res.render('template.ejs', {
                "title": `Directory: ${req_url || '/'}`,
                "content": content,
                "page": null,
                "params": {}
            });
            return;
        }
    } catch (error) {
        // If there's an error reading the directory, continue to 404
    }

    res.status(404).send('404 Not Found!');
}

function get_ip_address() {
    const networkInterfaces = os.networkInterfaces();
    const ipAddresses = [];

    Object.keys(networkInterfaces).forEach((interfaceName) => {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
            if (!iface.internal && iface.family === 'IPv4') {
                ipAddresses.push(iface.address);
            }
        }
    });

    return ipAddresses.length >= 1 ? ipAddresses[0] : '127.0.0.1';
}
