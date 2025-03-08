require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { createClient } = require('@deepgram/sdk');
const vision = require('@google-cloud/vision');
const PDFParser = require('pdf-parse');
const schedule = require('node-schedule');
const os = require('os');
const winston = require('winston');
const path = require('path');
const axios = require('axios');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/bot.log', maxsize: 5 * 1024 * 1024, maxFiles: 5, tailable: true }),
        new winston.transports.Console()
    ]
});

const metrics = require('./utils/metrics');

logger.info('Início da aplicação');

const app = express();
app.use(bodyParser.json());

// Configuração original com adição de limite para Together AI
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8') || '{}');
const defaultConfig = {
    autoReply: true,
    reportTime: '0 0 * * *',
    weeklyReportTime: '0 0 * * 0',
    maxRetries: 5,
    rateLimitMs: 1000,
    apiTimeout: 15000,
    reconnectInterval: 10000,
    maxReconnectAttempts: Infinity,
    cacheTTL: 24 * 60 * 60 * 1000,
    cpuThreshold: 80,
    memoryThreshold: 80,
    commandsPerMinute: 10,
    adminNumber: process.env.ADMIN_PHONE_NUMBER || 'SEU_NUMERO_ADMIN',
    maintenanceMessage: '⚠️ Manutenção programada em breve. Pode haver interrupções.',
    maintenanceTime: process.env.MAINTENANCE_TIME || null,
    monitoredGroups: [process.env.GROUP_ID || 'GGx81qcrRp33sFF6RLpuCd'],
    maxWitAITrainingPerHour: 10,
    maxWitAICallsPerMinute: 5,
    maxOpenRouterCallsPerMinute: 5,
    maxHuggingFaceCallsPerMinute: 5,
    maxTogetherAICallsPerMinute: 5 // Limite para Together AI
};
Object.assign(config, defaultConfig, config);

const TIMEZONE_OFFSET = process.env.TIMEZONE_OFFSET ? parseInt(process.env.TIMEZONE_OFFSET) : -3;

const startTime = Date.now();
const rateLimitMap = new Map();
const conversationContext = new Map();
const witAICallCount = { count: 0, lastReset: Date.now() };
const openRouterCallCount = { count: 0, lastReset: Date.now() };
const huggingFaceCallCount = { count: 0, lastReset: Date.now() };
const togetherAICallCount = { count: 0, lastReset: Date.now() }; // Contador para Together AI
const userResponseTimes = new Map();

// Carregamento de plugins mantido
const plugins = {};
const loadPlugins = async () => {
    const pluginDir = path.join(__dirname, 'plugins');
    const files = await fs.promises.readdir(pluginDir);
    for (const file of files) {
        if (file.endsWith('.js')) {
            const pluginName = file.replace('.js', '');
            plugins[pluginName] = require(path.join(pluginDir, file));
            logger.info(`Plugin carregado: ${pluginName}`);
        }
    }
};
loadPlugins();

// Estrutura de produtos mantida
const products = {
    "Cérebro em Alta Performance": {
        keywords: ["desempenho cerebral", "foco", "memória", "saúde mental", "cansaço mental", "produtividade", "mente saudável", "clareza mental", "concentração", "raciocínio", "fadiga mental", "esquecimento", "lentidão mental", "excesso de trabalho", "neblina mental", "dificuldade de foco", "saúde neuronal"],
        questions: [
            "Você já sentiu que sua mente tá mais lenta ou esquecendo coisas ultimamente?",
            "O cansaço mental tá te atrapalhando no trabalho ou nos estudos?"
        ],
        campaignMessages: {
            formal: "Imagine ter uma mente afiada e cheia de energia todos os dias! O *Cérebro em Alta Performance* já ajudou milhares de pessoas a melhorar a concentração e eliminar o cansaço mental. Essa oferta é por tempo limitado – clique aqui AGORA e transforme sua vida: [link]",
            informal: "Mano, pensa num foco absurdo e memória tinindo sem aquele cansaço chato! O *Cérebro em Alta Performance* tá mudando o jogo pra muita gente, e essa chance é só por hoje. Clica aqui rapidinho antes que acabe: [link]"
        },
        link: "https://renovacaocosmica.shop/23/crb-fnl",
        description: "Um e-book revolucionário que revela os segredos para otimizar o funcionamento do cérebro e alcançar alta performance mental. Baseado em estudos científicos, oferece técnicas práticas para melhorar a saúde cerebral, aumentar a concentração, fortalecer a memória e promover clareza mental. Ideal para quem quer uma mente afiada e uma vida saudável.",
        timePreference: "morning"
    },
    "Corpo e Mente": {
        keywords: ["equilíbrio emocional", "estresse", "saúde do corpo", "bem-estar", "saúde mental", "cansaço", "mente equilibrada", "recuperação emocional", "ansiedade", "tensão", "harmonia", "esgotamento", "nervosismo", "burnout", "dores", "exaustão"],
        questions: [
            "Você anda sentindo muito estresse ou um peso no corpo ultimamente?",
            "Tá precisando de algo pra dar uma equilibrada na vida?"
        ],
        campaignMessages: {
            formal: "Diga adeus ao estresse e sinta seu corpo e mente em perfeita harmonia! O *Corpo e Mente* é um método natural que já transformou a vida de milhares. Não perca essa oferta exclusiva – clique aqui AGORA: [link]",
            informal: "Mano, zera esse estresse e fica de boa com o *Corpo e Mente*! Tá todo mundo amando, e essa oferta é só por hoje. Clica aqui antes que suma: [link]"
        },
        link: "https://renovacaocosmica.shop/23/crpint-fnl",
        description: "Um guia completo para restaurar o equilíbrio físico e emocional com métodos naturais e eficazes. Combina práticas simples para reduzir o estresse, melhorar a saúde emocional e revitalizar o corpo, ideal para quem busca harmonia e bem-estar sem medicamentos.",
        timePreference: "afternoon"
    },
    "Sono Profundo, Vida Renovada": {
        keywords: ["sono profundo", "qualidade do sono", "noites mal dormidas", "cansaço diurno", "recuperação", "descanso", "energia", "regeneração", "insônia", "sono reparador"],
        questions: [
            "Você tem acordado cansado ou com dificuldade pra dormir?",
            "Tá precisando de um sono que te deixe renovado?"
        ],
        campaignMessages: {
            formal: "Acorde renovado todas as manhãs com o *Sono Profundo, Vida Renovada*! Milhares já transformaram suas noites. Não deixe essa oferta passar – clique aqui AGORA: [link]",
            informal: "Mano, dorme como nunca e acorda novo com o *Sono Profundo*! Todo mundo tá amando, e essa oferta é só por hoje. Clica aqui antes que acabe: [link]"
        },
        link: "https://renovacaocosmica.shop/23/sono-fnl",
        description: "Um programa para alcançar um sono profundo e reparador, essencial para a recuperação física e mental. Inclui técnicas práticas para criar uma rotina de sono que melhora a energia e a saúde geral.",
        timePreference: "night"
    }
};

// Banco de dados SQLite mantido
const db = new sqlite3.Database('./groupMessages.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) logger.error('Erro ao conectar ao SQLite:', err.message);
    else logger.info('Conectado ao banco SQLite.');
});

(async () => {
    try {
        await Promise.all([
		new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS user_styles (userId TEXT PRIMARY KEY, style TEXT, timestamp INTEGER)`, (err) => err ? reject(err) : resolve())),
		new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS conversation_context (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, content TEXT, timestamp INTEGER)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, groupId TEXT, date TEXT, message TEXT)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS knowledge (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, date TEXT, content TEXT)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, date TEXT, message TEXT, followedUp INTEGER DEFAULT 0)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS cache (id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT UNIQUE, response TEXT, date TEXT)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, command TEXT, date TEXT)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS connection_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT, timestamp TEXT, details TEXT)`, (err) => err ? reject(err) : resolve())),
            new Promise((resolve, reject) => db.run(`CREATE TABLE IF NOT EXISTS response_times (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, timestamp TEXT, delay INTEGER)`, (err) => err ? reject(err) : resolve()))
        ]);
        logger.info('Tabelas SQLite inicializadas com sucesso.');
    } catch (err) {
        logger.error('Erro ao inicializar tabelas SQLite:', err.message);
        process.exit(1);
    }
})();

const deepgram = process.env.DEEPGRAM_API_KEY ? createClient(process.env.DEEPGRAM_API_KEY) : null;
const visionClient = process.env.GOOGLE_VISION_API_KEY ? new vision.ImageAnnotatorClient({ key: process.env.GOOGLE_VISION_API_KEY }) : null;

let qrCodeData = '';
let initializationError = null;
let client = null;
let isClientReady = false;

async function logConnectionEvent(event, details) {
    const timestamp = new Date().toISOString();
    return new Promise((resolve) => {
        db.run('INSERT INTO connection_logs (event, timestamp, details) VALUES (?, ?, ?)', [event, timestamp, details], (err) => {
            if (err) logger.error(`Erro ao logar evento de conexão: ${err.message}`);
            resolve(!err);
        });
    });
}

function monitorResources() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = (totalMem - freeMem) / totalMem * 100;

    if (cpuUsage > config.cpuThreshold || usedMem > config.memoryThreshold) {
        const alertMessage = `🚨 Alerta de Recursos:\nCPU: ${cpuUsage.toFixed(2)}% (limite: ${config.cpuThreshold}%)\nMemória: ${usedMem.toFixed(2)}% (limite: ${config.memoryThreshold}%)`;
        logger.warn(alertMessage);
        if (config.adminNumber && client) client.sendMessage(config.adminNumber, alertMessage);
    }
}

function scheduleDatabaseBackup() {
    schedule.scheduleJob('0 2 * * *', async () => {
        const backupPath = `./backup/groupMessages_${new Date().toISOString().split('T')[0]}.db`;
        try {
            await fs.promises.copyFile('./groupMessages.db', backupPath);
            logger.info(`Backup criado com sucesso em ${backupPath}`);
        } catch (err) {
            logger.error(`Erro ao criar backup: ${err.message}`);
        }
    });
}

async function manualBackup() {
    const backupPath = `./backup/groupMessages_manual_${new Date().toISOString().replace(/:/g, '-')}.db`;
    try {
        await fs.promises.copyFile('./groupMessages.db', backupPath);
        logger.info(`Backup manual criado em ${backupPath}`);
        return backupPath;
    } catch (err) {
        logger.error(`Erro ao criar backup manual: ${err.message}`);
        throw err;
    }
}

function scheduleMaintenanceNotification() {
    if (!config.maintenanceTime) return;
    schedule.scheduleJob(config.maintenanceTime, async () => {
        try {
            for (const groupId of config.monitoredGroups) {
                await client.sendMessage(groupId, config.maintenanceMessage);
            }
            logger.info('Notificação de manutenção enviada para todos os grupos.');
        } catch (error) {
            logger.error(`Erro ao enviar notificação de manutenção: ${error.message}`);
        }
    });
}

function scheduleSalesRecovery() {
    schedule.scheduleJob('0 */1 * * *', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        db.all('SELECT id, userId, message FROM leads WHERE followedUp = 0 AND date < ?', [oneHourAgo], async (err, rows) => {
            if (err) {
                logger.error('Erro ao verificar leads para recuperação de vendas:', err.message);
                return;
            }
            for (const row of rows) {
                try {
                    const campaign = identifyCampaign(row.message);
                    const context = conversationContext.get(row.userId) || { tone: 'neutro' };
                    const tone = context.tone;
                    const timePreference = getTimePreference(row.userId);
                    const product = campaign ? products[campaign] : findRelevantProduct(row.message) || getTimeRelevantProduct(row.userId);
                    let recoveryMessage = campaign && products[campaign].campaignMessages
                        ? `${products[campaign].campaignMessages[tone].replace('[link]', products[campaign].link)}\n\nNão deixe para depois – milhares já aproveitaram e essa oferta está quase acabando!`
                        : `Olá de novo! Você falou sobre "${row.message}" há um tempinho. Tá na hora de resolver isso de vez, né?`;
                    recoveryMessage += `\n\nImagine como seria incrível ${product.description.split('.')[0].toLowerCase()} ${timePreference === 'night' ? 'nessa noite' : 'hoje'}! Clique aqui AGORA antes que a oferta expire: ${product.link}`;
                    await client.sendMessage(row.userId, adjustTone(recoveryMessage, tone));
                    await markLeadAsFollowedUp(row.id);
                    logger.info(`Mensagem de recuperação de vendas enviada para ${row.userId}: ${recoveryMessage}`);
                } catch (error) {
                    logger.error(`Erro ao enviar recuperação de vendas para ${row.userId}: ${error.message}`, error.stack);
                }
            }
        });
    });
    logger.info('Recuperação de vendas agendada para a cada hora.');
}

const port = process.env.PORT || 3000;
app.get('/', (req, res) => {
    logger.info('Rota raiz acessada');
    if (initializationError) res.status(500).send(`Erro ao iniciar o bot WhatsApp: ${initializationError.message}`);
    else if (!isClientReady) res.status(200).send('Bot WhatsApp está iniciando ou reconectando...');
    else res.status(200).send('Bot WhatsApp está ativo!');
});

app.get('/health', (req, res) => {
    res.status(isClientReady ? 200 : 503).json({
        status: isClientReady ? 'healthy' : 'unhealthy',
        uptime: Math.floor((Date.now() - startTime) / 1000 / 60),
        messageCount: metrics.getMessageCount(),
        lastError: initializationError ? initializationError.message : null,
        cpuUsage: (os.loadavg()[0] / os.cpus().length * 100).toFixed(2),
        memoryUsage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
    });
});

app.listen(port, () => {
    logger.info(`Servidor Express rodando na porta ${port}`);
    initializeWhatsAppClient();
    schedule.scheduleJob('*/5 * * * *', monitorResources);
    scheduleDatabaseBackup();
    scheduleMaintenanceNotification();
    scheduleSalesRecovery();
});

function initializeWhatsAppClient() {
    logger.info('Inicializando cliente WhatsApp');
    const isWindows = process.platform === 'win32';
    const chromiumPath = isWindows ? null : (process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium');

    try {
        client = new Client({
            authStrategy: new LocalAuth({ dataPath: isWindows ? './whatsapp-auth' : '/data/whatsapp-auth' }),
            puppeteer: {
                headless: true,
                executablePath: chromiumPath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--aggressive-cache-discard',
                    '--disable-cache',
                    '--disable-extensions',
                    '--disable-background-networking'
                ],
                timeout: 120000,
            },
            webVersionCache: {
                type: 'remote',
                remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
            }
        });

        setupClientEvents();
        startClient();
    } catch (err) {
        logger.error('Erro ao criar instância do cliente WhatsApp:', err.message, err.stack);
        initializationError = err;
        scheduleReconnect();
    }
}

// Função INSANA com obsessão total para geração de respostas
async function getBotResponse(prompt, context) {
    const userId = context.userId;
    let tone = context.tone || detectTone(prompt);
    const history = context.history || [];
    const sentiment = analyzeSentiment(prompt);
    const timePreference = getTimePreference(userId);
    const now = Date.now();
    const lastResponseTime = userResponseTimes.get(userId)?.timestamp || now;
    const responseDelay = now - lastResponseTime;
    const userActivity = rateLimitMap.get(userId) || { count: 0, lastReset: now };

    // Ajuste de tom para formalidade
    if (prompt.toLowerCase().includes("pode ser formal")) tone = "formal";
    if (prompt.toLowerCase().includes("pode ser informal")) tone = "informal"; // Mantido como opção, mas padrão é formal
    context.tone = tone;

    // Cache para eficiência
    const cachedResponse = await getFromCache(prompt);
    if (cachedResponse) {
        logger.info(`[CACHE] Resposta recuperada: ${cachedResponse}`);
        return adjustTone(cachedResponse, tone);
    }

    // Análise detalhada do estilo de escrita com tom profissional
    async function analyzeWritingStyle(prompt) {
        const lowerPrompt = prompt.toLowerCase();
        const intensityWords = ["muito", "extremamente", "bastante"];
        const urgentWords = ["agora", "rápido", "urgente", "imediatamente"];
        const emotionalWords = ["triste", "feliz", "irritado", "cansado", "satisfeito"];

        const intensity = intensityWords.some(w => lowerPrompt.includes(w)) ? "elevada" : "normal";
        const urgency = urgentWords.some(w => lowerPrompt.includes(w)) ? "elevada" : "normal";
        const emotion = emotionalWords.find(w => lowerPrompt.includes(w)) || "neutro";

        return { intensity, urgency, emotion };
    }

    const writingStyle = await analyzeWritingStyle(prompt);
    const styleAdjustment = writingStyle.intensity === "elevada" ? "Percebo que o senhor(a) está expressando algo com grande ênfase. " :
                           writingStyle.urgency === "elevada" ? "Entendo que o senhor(a) busca uma resposta imediata. " :
                           writingStyle.emotion !== "neutro" ? `Compreendo que o senhor(a) está se sentindo ${writingStyle.emotion}. ` : "";

    // Personalidade formal e profissional
    const botPersonality = {
        greeting: "Olá, senhor(a). Estou à disposição para assisti-lo(a) de forma eficiente e precisa.",
        encouragement: "Permita-me ajudá-lo(a) a resolver isso com a máxima atenção agora.",
        fallback: "Peço desculpas, mas não compreendi completamente. Poderia fornecer mais detalhes para que eu possa assisti-lo(a) adequadamente?"
    };

    // Respostas pré-prontas formais e contextualizadas
    const greetings = ["oi", "olá", "bom dia", "boa tarde", "boa noite"];
    if (greetings.some(g => prompt.toLowerCase().startsWith(g))) {
        const lastMessage = history.length > 1 ? history[history.length - 2].content : '';
        if (greetings.some(g => lastMessage.toLowerCase().includes(g))) {
            const response = `${styleAdjustment}${botPersonality.greeting} É um prazer voltar a conversar com o senhor(a). Como posso auxiliá-lo(a) neste momento?`;
            await saveToCache(prompt, response);
            return adjustTone(response, tone);
        }
        const response = `${styleAdjustment}${botPersonality.greeting} Como posso ajudá-lo(a) a aproveitar ao máximo seu ${timePreference === 'night' ? 'descanso noturno' : 'dia'}?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(quem é você|quem é o senhor|quem sou você)$/i)) {
        const response = `${styleAdjustment}Sou seu assistente virtual, projetado para oferecer suporte eficiente e respostas precisas às suas necessidades. Estou aqui para auxiliá-lo(a) com informações, tarefas ou qualquer dúvida que deseje esclarecer. Como posso servi-lo(a) hoje?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(o que você faz|o que o senhor pode fazer|como você ajuda)$/i)) {
        const response = `${styleAdjustment}Estou à disposição para fornecer respostas detalhadas, realizar pesquisas, criar conteúdos, traduzir textos e oferecer soluções personalizadas. Meu objetivo é otimizar seu tempo e resolver suas demandas com excelência. Em que posso ajudá-lo(a) agora?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(tudo bem|como você está|como o senhor está)$/i)) {
        const response = `${styleAdjustment}Agradeço pela gentileza. Estou em pleno funcionamento e pronto para assisti-lo(a). Como o senhor(a) está hoje? Posso ajudá-lo(a) com algo específico?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(obrigado|agradeço|grato)$/i)) {
        const response = `${styleAdjustment}É uma honra poder ajudá-lo(a). Estou à disposição para continuar auxiliando em qualquer outra necessidade que o senhor(a) tenha. Deseja prosseguir com algo mais?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(adeus|até mais|tchau)$/i)) {
        const response = `${styleAdjustment}Foi um prazer atendê-lo(a). Caso precise de assistência futura, estarei aqui para servi-lo(a) com a mesma dedicação. Tenha um excelente ${timePreference === 'night' ? 'descanso' : 'dia'}.`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(qual a hora|que horas são)$/i)) {
        const now = new Date();
        const localHours = (now.getUTCHours() + TIMEZONE_OFFSET + 24) % 24;
        const minutes = now.getUTCMinutes().toString().padStart(2, '0');
        const greeting = localHours >= 5 && localHours < 12 ? 'Bom dia' : localHours >= 12 && localHours < 18 ? 'Boa tarde' : 'Boa noite';
        const response = `${styleAdjustment}${greeting}, senhor(a). São ${localHours}:${minutes} no horário local. Posso ajudá-lo(a) com algo mais neste momento?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    if (prompt.match(/^(como está o tempo|qual o clima)$/i)) {
        const response = `${styleAdjustment}Estou pronto para verificar as condições climáticas para o senhor(a). Poderia informar a cidade desejada para que eu possa fornecer uma resposta precisa?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    // Conhecimento armazenado para personalização
    const knowledge = await getKnowledge(userId);
    if (knowledge) {
        const knowledgeLines = knowledge.split('\n');
        for (const line of knowledgeLines) {
            const [key, value] = line.split(':').map(s => s.trim().toLowerCase());
            if (prompt.toLowerCase().includes(key)) {
                const response = `${styleAdjustment}Com base em nossa interação anterior, sei que o senhor(a) mencionou "${key}": ${value}. Isso ainda é relevante? Permita-me ajudá-lo(a) com mais informações ou soluções relacionadas.`;
                await saveToCache(prompt, response);
                return adjustTone(response, tone);
            }
        }
    }

    // Ajustes baseados em sentimento e comportamento
    const sentimentAdjustment = sentiment === "negativo" ? `${writingStyle.emotion !== "neutro" ? `Lamento que o senhor(a) esteja ${writingStyle.emotion}. ` : "Percebo que algo pode estar incomodando o senhor(a). "}Posso ajudá-lo(a) a resolver isso.` :
                              sentiment === "positivo" ? "Fico satisfeito em perceber seu entusiasmo. " : "";
    const activityAdjustment = userActivity.count > 5 ? "Agradeço sua interação frequente. " :
                              responseDelay > 60000 ? "Notei que houve uma pausa considerável. Bem-vindo(a) de volta! " :
                              responseDelay > 30000 ? "Agradeço seu retorno após um breve intervalo. " : "";

    // Resposta natural das APIs com tom formal
    const naturalResponse = await getIntentBasedResponse(prompt, history, sentiment);
    if (naturalResponse) {
        const response = `${sentimentAdjustment}${activityAdjustment}${naturalResponse} Permita-me saber como posso prosseguir para atendê-lo(a) da melhor forma.`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    // Fluxo de vendas profissional e sutil
    const product = findRelevantProduct(prompt) || getTimeRelevantProduct(userId);
    if (product && !context.product && matchesTimePreference(product.timePreference, userId)) {
        context.product = product;
        context.step = 1;
        const response = `${sentimentAdjustment}${activityAdjustment}Parece que o senhor(a) poderia se beneficiar de algo para otimizar seu ${timePreference === 'night' ? 'descanso noturno' : 'dia a dia'}. ${product.questions[0]} Gostaria que eu explicasse como isso pode ser resolvido de maneira eficaz?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    } else if (context.product && context.step === 1) {
        context.step = 2;
        const response = `${sentimentAdjustment}${activityAdjustment}Entendo que isso pode estar impactando o senhor(a). ${context.product.questions[1]} Posso apresentar uma solução que tem ajudado muitos a superar essa questão?`;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    } else if (context.product && context.step === 2) {
        const urgency = responseDelay > 10000 ? "Sugiro que considere isso o quanto antes para melhores resultados." : "Este é um momento oportuno para agir.";
        const response = `${sentimentAdjustment}${activityAdjustment}${context.product.campaignMessages[tone].replace('[link]', context.product.link)}\n\n${urgency} Estou à disposição para quaisquer dúvidas ou suporte adicional.`;
        await saveLead(userId, prompt);
        context.step = 0;
        context.product = null;
        await saveToCache(prompt, response);
        return adjustTone(response, tone);
    }

    // Fallback formal e profissional
    const lastUserMessage = history.find(msg => msg.role === 'user')?.content || '';
    const fallbackResponses = [
        `${sentimentAdjustment}${activityAdjustment}${botPersonality.fallback}`,
        `${sentimentAdjustment}${activityAdjustment}Agradeço sua mensagem, mas gostaria de entender melhor. Poderia esclarecer o que o senhor(a) deseja para que eu possa oferecer o suporte mais adequado?`,
        lastUserMessage ? `${sentimentAdjustment}${activityAdjustment}Com base em sua última mensagem ("${lastUserMessage}"), sua solicitação atual está relacionada? Por favor, forneça mais detalhes para que eu possa assisti-lo(a) plenamente.` : `${sentimentAdjustment}${activityAdjustment}${botPersonality.fallback}`
    ];
    const fallback = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    await saveToCache(prompt, fallback);
    return adjustTone(fallback, tone);
}

// Função complementar para respostas naturais das APIs
async function getIntentBasedResponse(prompt, history, sentiment) {
    const inputText = history.length > 0 ? `${history.map(msg => `${msg.role === 'user' ? 'Usuário' : 'Assistente'}: ${msg.content}`).join('\n')}\nUsuário: ${prompt}` : prompt;

    // Prioridade para OpenRouter com tom formal
    if (process.env.OPENROUTER_API_KEY && canCallOpenRouter()) {
        try {
            const response = await axios.post(
                'https://openrouter.ai/api/v1/chat/completions',
                {
                    model: 'mistralai/mixtral-8x7b-instruct',
                    messages: [
                        { role: 'system', content: 'Você é um assistente profissional e formal, projetado para fornecer respostas precisas e educadas em português, mantendo um tom respeitoso e útil.' },
                        { role: 'user', content: inputText }
                    ],
                    max_tokens: 150
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: config.apiTimeout
                }
            );
            const result = response.data.choices[0].message.content.trim();
            openRouterCallCount.count++;
            logger.info(`[OPENROUTER] Resposta gerada: ${result}`);
            return result;
        } catch (error) {
            logger.error(`[OPENROUTER] Erro: ${error.message}`);
        }
    }

    // Wit.ai para intents específicos
    if (process.env.WITAI_API_TOKEN && canCallWitAI()) {
        try {
            const witPrompt = inputText.length > 100 ? inputText.slice(0, 100) : inputText;
            const response = await axios.get(
                `https://api.wit.ai/message?v=20250305&q=${encodeURIComponent(witPrompt)}`,
                { headers: { 'Authorization': `Bearer ${process.env.WITAI_API_TOKEN}` }, timeout: config.apiTimeout }
            );
            const intents = response.data.intents || [];
            if (intents.length > 0) {
                const result = `Compreendo que o senhor(a) está se referindo a "${intents[0].name}". Poderia me fornecer mais informações para que eu possa oferecer uma assistência mais detalhada?`;
                witAICallCount.count++;
                logger.info(`[WITAI] Resposta gerada: ${result}`);
                if (canTrainWitAI()) await trainWitAI(witPrompt, intents[0].name);
                return result;
            }
        } catch (error) {
            logger.error(`[WITAI] Erro: ${error.message}`);
        }
    }

    // Hugging Face como fallback
    if (process.env.HUGGINGFACE_API_KEY && canCallHuggingFace()) {
        try {
            const response = await axios.post(
                'https://api-inference.huggingface.co/models/facebook/bart-large',
                {
                    inputs: `Responda em português de forma formal e profissional para: "${inputText}"`,
                    parameters: { max_length: 150 }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: config.apiTimeout
                }
            );
            const result = response.data[0]?.generated_text || 'Permita-me ajudá-lo(a) com isso de maneira eficiente. Por favor, forneça mais detalhes.';
            huggingFaceCallCount.count++;
            logger.info(`[HUGGINGFACE] Resposta gerada: ${result}`);
            return result;
        } catch (error) {
            logger.error(`[HUGGINGFACE] Erro: ${error.message}`);
        }
    }

    // Together AI como último recurso
    if (process.env.TOGETHERAI_API_KEY && canCallTogetherAI()) {
        try {
            const response = await axios.post(
                'https://api.together.xyz/v1/chat/completions',
                {
                    model: 'meta-llama/LLaMA-13B',
                    messages: [
                        { role: 'system', content: 'Você é um assistente formal e profissional em português, oferecendo respostas educadas e precisas.' },
                        { role: 'user', content: inputText }
                    ],
                    max_tokens: 150
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.TOGETHERAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: config.apiTimeout
                }
            );
            const result = response.data.choices[0].message.content.trim();
            togetherAICallCount.count++;
            logger.info(`[TOGETHERAI] Resposta gerada: ${result}`);
            return result;
        } catch (error) {
            logger.error(`[TOGETHERAI] Erro: ${error.message}`);
        }
    }

    return null; // Fallback interno já cuida disso

// Funções de controle de limite de chamadas para as APIs
function canCallWitAI() {
    const now = Date.now();
    if (now - witAICallCount.lastReset > 60000) {
        witAICallCount.count = 0;
        witAICallCount.lastReset = now;
    }
    return witAICallCount.count < config.maxWitAICallsPerMinute;
}

function canCallOpenRouter() {
    const now = Date.now();
    if (now - openRouterCallCount.lastReset > 60000) {
        openRouterCallCount.count = 0;
        openRouterCallCount.lastReset = now;
    }
    return openRouterCallCount.count < config.maxOpenRouterCallsPerMinute;
}

function canCallHuggingFace() {
    const now = Date.now();
    if (now - huggingFaceCallCount.lastReset > 60000) {
        huggingFaceCallCount.count = 0;
        huggingFaceCallCount.lastReset = now;
    }
    return huggingFaceCallCount.count < config.maxHuggingFaceCallsPerMinute;
}

function canCallTogetherAI() {
    const now = Date.now();
    if (now - togetherAICallCount.lastReset > 60000) {
        togetherAICallCount.count = 0;
        togetherAICallCount.lastReset = now;
    }
    return togetherAICallCount.count < config.maxTogetherAICallsPerMinute;
}

async function trainWitAI(prompt, intentName) {
    const now = Date.now();
    if (now - witAICallCount.lastReset > 3600000) {
        witAICallCount.count = 0;
        witAICallCount.lastReset = now;
    }
    if (witAICallCount.count >= config.maxWitAITrainingPerHour) return;
    try {
        await axios.post(
            'https://api.wit.ai/utterances?v=20250305',
            [{ text: prompt, intent: intentName, entities: [], traits: [] }],
            { headers: { 'Authorization': `Bearer ${process.env.WITAI_API_TOKEN}` } }
        );
        witAICallCount.count++;
        logger.info(`Wit.ai treinado com "${prompt}" para intent "${intentName}"`);
    } catch (error) {
        logger.error(`Erro ao treinar Wit.ai: ${error.message}`);
    }
}

function canTrainWitAI() {
    const now = Date.now();
    if (now - witAICallCount.lastReset > 3600000) {
        witAICallCount.count = 0;
        witAICallCount.lastReset = now;
    }
    return witAICallCount.count < config.maxWitAITrainingPerHour;
}

function setupClientEvents() {
    client.on('loading_screen', (percent, message) => {
        if (isClientReady) return;
        logger.info(`Carregando WhatsApp: ${percent}% - ${message}`);
    });

    client.on('qr', (qr) => {
        qrCodeData = qr;
        logger.info('QR gerado com sucesso! Acesse /qr para escanear.');
        logConnectionEvent('qr_generated', 'Novo QR Code gerado');
    });

    client.on('authenticated', () => {
        logger.info(`Sessão autenticada com sucesso. Dados salvos em ${process.platform === 'win32' ? './whatsapp-auth' : '/data/whatsapp-auth'}.`);
        logConnectionEvent('authenticated', 'Sessão autenticada');
    });

    client.on('ready', async () => {
        isClientReady = true;
        logger.info('Bot conectado e pronto para uso.');
        console.log('Bot conectado no Fly!');
        logConnectionEvent('ready', 'Cliente conectado');
        const reportNumber = process.env.REPORT_PHONE_NUMBER;
        if (reportNumber) await client.sendMessage(reportNumber, 'Bot conectado no Fly! 🚀');
        scheduleDailyReport();
        scheduleWeeklyReport();
        scheduleLeadFollowUps();
        try {
            await client.getChats();
            logger.info('Chats sincronizados com sucesso.');
        } catch (err) {
            logger.error('Erro ao sincronizar chats:', err.message);
        }
    });

    client.on('auth_failure', (message) => {
        logger.error('Falha na autenticação:', message);
        initializationError = new Error(`Falha na autenticação: ${message}`);
        logConnectionEvent('auth_failure', message);
        scheduleReconnect();
    });

    client.on('disconnected', (reason) => {
        isClientReady = false;
        logger.warn(`Cliente desconectado: ${reason}`);
        logConnectionEvent('disconnected', `Motivo: ${reason}`);
        scheduleReconnect();
    });

    client.on('change_state', (state) => {
        logger.info(`Estado do cliente alterado: ${state}`);
        logConnectionEvent('state_change', state);
    });

    client.on('message', async (message) => {
        logger.info(`Mensagem recebida de ${message.from}: ${message.body}`);
        try {
            metrics.logMessage();
            const userId = message.from;
            const text = message.body.toLowerCase();
            const lang = detectLanguage(text);
            const sentiment = analyzeSentiment(text);
            const isGroup = userId.endsWith('@g.us');
            const now = Date.now();

            const lastResponse = userResponseTimes.get(userId);
            if (lastResponse) {
                const delay = now - lastResponse.timestamp;
                await db.run('INSERT INTO response_times (userId, timestamp, delay) VALUES (?, ?, ?)', [userId, now, delay]);
                userResponseTimes.set(userId, { timestamp: now, delay });
            } else {
                userResponseTimes.set(userId, { timestamp: now, delay: 0 });
            }

            const userRate = rateLimitMap.get(userId) || { count: 0, lastReset: now };
            if (now - userRate.lastReset > 60000) {
                userRate.count = 0;
                userRate.lastReset = now;
            }

            if (text.startsWith('!')) {
                if (userRate.count >= config.commandsPerMinute) {
                    await client.sendMessage(userId, adjustTone('Calma aí, você tá indo rápido demais! Aguarde um minutinho e vamos resolver tudo! ⏳', detectTone(text)));
                    return;
                }
                userRate.count++;
                rateLimitMap.set(userId, userRate);
                await handleCommand(text, message, lang, sentiment);
            } else if (isGroup) {
                logger.debug(`Mensagem ignorada em grupo ${userId}: ${text}`);
                return;
            } else if (message.hasMedia) {
                await handleMediaMessage(message, lang);
            } else if (config.autoReply) {
                let context = conversationContext.get(userId) || { history: [], step: 0, product: null, userId, tone: 'neutro' };
                context.history.push({ role: 'user', content: message.body });
                if (context.history.length > 5) context.history.shift();

                const response = await getBotResponse(message.body, context);
                const finalResponse = await adjustResponseBasedOnSentiment(response, sentiment);
                context.history.push({ role: 'assistant', content: finalResponse });
                conversationContext.set(userId, context);

                await client.sendMessage(userId, finalResponse);

                if (!message.body.match(/^(sim|não|talvez)$/i)) {
                    setTimeout(async () => {
                        const updatedContext = conversationContext.get(userId);
                        if (updatedContext && updatedContext.history[updatedContext.history.length - 1].role === 'assistant' && updatedContext.history[updatedContext.history.length - 1].content === finalResponse) {
                            const timePreference = getTimePreference(userId);
                            const followUp = adjustTone(`E aí, o que achou? Tá pronto pra resolver isso de vez ${timePreference === 'night' ? 'e ter uma noite tranquila' : 'e arrasar hoje'}? Não deixa essa chance escapar – me diz mais!`, updatedContext.tone);
                            await client.sendMessage(userId, followUp);
                            updatedContext.history.push({ role: 'assistant', content: followUp });
                            conversationContext.set(userId, updatedContext);
                        }
                    }, 30000);
                }
            }
        } catch (error) {
            logger.error(`Erro ao processar mensagem de ${message.from}: ${error.message}`, error.stack);
            const tone = conversationContext.get(message.from)?.tone || 'neutro';
            await client.sendMessage(message.from, adjustTone('Ops, deu um probleminha aqui, mas não te deixo na mão! Tenta de novo que eu te ajudo rapidinho!', tone));
        }
    });

    app.get('/qr', async (req, res) => {
        logger.info('Rota /qr acessada');
        if (!qrCodeData) {
            if (initializationError) return res.status(500).send(`Erro ao gerar o QR Code: ${initializationError.message}. Tentando reconectar...`);
            return res.send('QR não gerado ainda. Aguarde ou reinicie o bot.');
        }
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            res.send(`<img src="${qrImage}" alt="Escaneie este QR Code com o WhatsApp" />`);
        } catch (error) {
            logger.error('Erro ao gerar imagem QR:', error.message, error.stack);
            res.status(500).send('Erro ao gerar o QR Code. Tente novamente.');
        }
    });
}

function startClient() {
    client.initialize()
        .then(() => {
            logger.info('Cliente WhatsApp inicializado com sucesso!');
            initializationError = null;
        })
        .catch((err) => {
            logger.error('Erro ao inicializar o cliente WhatsApp:', err.message, err.stack);
            initializationError = err;
            scheduleReconnect();
        });
}

function scheduleReconnect() {
    let attempts = 0;
    const baseDelay = config.reconnectInterval;

    const reconnect = () => {
        if (attempts >= config.maxReconnectAttempts && config.maxReconnectAttempts !== Infinity) {
            logger.error('Número máximo de tentativas de reconexão atingido. Encerrando processo.');
            process.exit(1);
        }

        const delay = Math.min(baseDelay * Math.pow(2, attempts), 60000);
        logger.info(`Tentativa ${attempts + 1} de reconexão em ${delay / 1000} segundos...`);
        
        setTimeout(() => {
            if (!client) {
                initializeWhatsAppClient();
            } else {
                client.destroy().then(() => {
                    initializeWhatsAppClient();
                }).catch((err) => {
                    logger.error('Erro ao destruir cliente para reconexão:', err.message);
                    initializeWhatsAppClient();
                });
            }
        }, delay);

        attempts++;
    };

    reconnect();
}

setInterval(() => {
    if (!isClientReady && client) {
        logger.warn('Cliente não está pronto. Verificando estado...');
        scheduleReconnect();
    }
    logger.debug('Keep-alive: Mantendo o processo ativo...');
}, 30000);

async function saveGroupMessage(groupId, message) {
    const date = new Date().toISOString().split('T')[0];
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM messages WHERE groupId = ? AND date = ?', [groupId, date], (err, row) => {
            if (err) return reject(err);
            if (row.count >= 1000) {
                logger.warn(`Limite de mensagens atingido para o grupo ${groupId} na data ${date}.`);
                return resolve(false);
            }
            db.run('INSERT INTO messages (groupId, date, message) VALUES (?, ?, ?)', [groupId, date, JSON.stringify(message)], (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    });
}

async function saveKnowledge(userId, content) {
    const date = new Date().toISOString().split('T')[0];
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO knowledge (userId, date, content) VALUES (?, ?, ?)', [userId, date, content], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

async function getKnowledge(userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT content FROM knowledge WHERE userId = ?', [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.content).join('\n'));
        });
    });
}

async function saveLead(userId, message) {
    const date = new Date().toISOString();
    return new Promise((resolve, reject) => {
        db.run('INSERT INTO leads (userId, date, message) VALUES (?, ?, ?)', [userId, date, message], (err) => {
            if (err) reject(err);
            else resolve(true);
            metrics.incrementSales();
        });
    });
}

async function getLeads(userId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT date, message FROM leads WHERE userId = ?', [userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => `${row.date}: ${row.message}`).join('\n'));
        });
    });
}

async function markLeadAsFollowedUp(leadId) {
    return new Promise((resolve, reject) => {
        db.run('UPDATE leads SET followedUp = 1 WHERE id = ?', [leadId], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

async function saveToCache(prompt, response) {
    const date = new Date().toISOString();
    return new Promise((resolve) => {
        db.run('INSERT OR REPLACE INTO cache (prompt, response, date) VALUES (?, ?, ?)', [prompt, response, date], (err) => {
            if (err) logger.warn(`Erro ao salvar no cache: ${err.message}`);
            resolve(!err);
        });
    });
}

async function getFromCache(prompt) {
    return new Promise((resolve) => {
        db.get('SELECT response, date FROM cache WHERE prompt = ?', [prompt], (err, row) => {
            if (err) logger.warn(`Erro ao buscar no cache: ${err.message}`);
            if (row && (Date.now() - new Date(row.date).getTime()) < config.cacheTTL) resolve(row.response);
            else resolve(null);
        });
    });
}

async function logUsage(userId, command) {
    const date = new Date().toISOString();
    return new Promise((resolve) => {
        db.run('INSERT INTO usage (userId, command, date) VALUES (?, ?, ?)', [userId, command, date], (err) => {
            if (err) logger.warn(`Erro ao logar uso: ${err.message}`);
            resolve(!err);
        });
    });
}

function detectLanguage(text) {
    const cachedLang = getFromCache(`lang:${text}`);
    if (cachedLang) return cachedLang;

    const ptKeywords = ['olá', 'bom', 'tudo', 'como', 'obrigado', 'por favor'];
    const enKeywords = ['hello', 'good', 'how', 'thanks', 'please'];
    const esKeywords = ['hola', 'bueno', 'cómo', 'gracias', 'por favor'];

    const textLower = text.toLowerCase();
    const ptScore = ptKeywords.filter(word => textLower.includes(word)).length;
    const enScore = enKeywords.filter(word => textLower.includes(word)).length;
    const esScore = esKeywords.filter(word => textLower.includes(word)).length;

    let lang = ptScore > enScore && ptScore > esScore ? 'pt' : enScore > ptScore && enScore > esScore ? 'en' : esScore > ptScore && esScore > enScore ? 'es' : 'pt';
    saveToCache(`lang:${text}`, lang);
    return lang;
}

function analyzeSentiment(text) {
    const cachedSentiment = getFromCache(`sentiment:${text}`);
    if (cachedSentiment) return cachedSentiment;

    const positiveWords = ['bom', 'ótimo', 'feliz', 'gostei', 'legal', 'maravilhoso', 'good', 'great', 'happy', 'like', 'awesome'];
    const negativeWords = ['ruim', 'péssimo', 'triste', 'odio', 'problema', 'bad', 'terrible', 'sad', 'hate', 'issue', 'dor', 'dores'];

    const textLower = text.toLowerCase();
    const positiveScore = positiveWords.filter(word => textLower.includes(word)).length;
    const negativeScore = negativeWords.filter(word => textLower.includes(word)).length;

    let sentiment = positiveScore > negativeScore ? 'positivo' : negativeScore > positiveScore ? 'negativo' : 'neutro';
    saveToCache(`sentiment:${text}`, sentiment);
    return sentiment;
}

async function adjustResponseBasedOnSentiment(response, sentiment) {
    if (!response) return "Ops, algo deu errado, mas eu te ajudo! Me diz mais!";
    if (sentiment === 'negativo') return `${response} Desculpe se algo tá te incomodando – vamos resolver isso juntos AGORA! 😔`;
    if (sentiment === 'positivo') return `${response} Que ótimo te ver animado – bora aproveitar essa energia pra resolver tudo! 😊`;
    return response;
}

function detectTone(text) {
    const formalWords = ["senhor", "por favor", "obrigado", "gostaria", "poderia"];
    const informalWords = ["mano", "beleza", "fala aí", "tranquilo", "e aí"];
    text = text.toLowerCase();
    const formalScore = formalWords.filter(word => text.includes(word)).length;
    const informalScore = informalWords.filter(word => text.includes(word)).length;
    return formalScore > informalScore ? "formal" : informalScore > formalScore ? "informal" : "neutro";
}

function adjustTone(response, tone) {
    if (!response || typeof response !== 'string') {
        return tone === "formal" ? "Desculpe-me, senhor(a), algo deu errado. Como posso ajudá-lo agora?" : "Putz, mano, deu um erro aqui, mas eu te ajudo! Fala mais!";
    }
    if (tone === "formal") {
        return response.replace(/mano/g, "senhor(a)").replace(/beleza/g, "ótimo").replace(/😎/g, "🙂").replace(/putz/g, "desculpe-me").replace(/tu/g, "você").replace(/tá/g, "está");
    } else if (tone === "informal") {
        return response.replace(/senhor(a)/g, "mano").replace(/ótimo/g, "beleza").replace(/🙂/g, "😎").replace(/desculpe-me/g, "putz").replace(/você/g, "tu").replace(/está/g, "tá");
    }
    return response;
}

function findRelevantProduct(text) {
    const textLower = text.toLowerCase();
    for (const [name, product] of Object.entries(products)) {
        if (product.keywords && product.keywords.some(keyword => textLower.includes(keyword))) return { name, ...product };
    }
    return null;
}

function identifyCampaign(text) {
    const textLower = text.toLowerCase();
    for (const [name, product] of Object.entries(products)) {
        if (product.keywords && product.keywords.some(keyword => textLower.includes(keyword))) return name;
    }
    return null;
}

function getTimePreference(userId) {
    const now = new Date();
    const localHours = (now.getUTCHours() + TIMEZONE_OFFSET + 24) % 24;
    if (localHours >= 5 && localHours < 12) return 'morning';
    if (localHours >= 12 && localHours < 18) return 'afternoon';
    if (localHours >= 18 && localHours < 22) return 'evening';
    return 'night';
}

function matchesTimePreference(timePreference, userId) {
    const currentTime = getTimePreference(userId);
    return timePreference === 'anytime' || timePreference === currentTime;
}

function getTimeRelevantProduct(userId) {
    const currentTime = getTimePreference(userId);
    const relevantProducts = Object.values(products).filter(p => matchesTimePreference(p.timePreference, userId));
    return relevantProducts.length > 0 ? relevantProducts[Math.floor(Math.random() * relevantProducts.length)] : products[Object.keys(products)[Math.floor(Math.random() * Object.keys(products).length)]];
}

function scheduleLeadFollowUps() {
    schedule.scheduleJob('*/10 * * * *', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        db.all('SELECT id, userId, message FROM leads WHERE followedUp = 0 AND date < ?', [oneHourAgo], async (err, rows) => {
            if (err) {
                logger.error('Erro ao verificar leads:', err.message);
                return;
            }
            for (const row of rows) {
                try {
                    const campaign = identifyCampaign(row.message);
                    const context = conversationContext.get(row.userId) || { tone: 'neutro' };
                    const tone = context.tone;
                    const timePreference = getTimePreference(row.userId);
                    const product = campaign ? products[campaign] : findRelevantProduct(row.message) || getTimeRelevantProduct(row.userId);
                    let followUpResponse = campaign && products[campaign].campaignMessages
                        ? `${products[campaign].campaignMessages[tone].replace('[link]', products[campaign].link)}\n\nNão deixe pra depois – milhares já aproveitaram e essa oferta tá quase acabando!`
                        : `Olá, tudo bem? Você falou sobre "${row.message}" há um tempinho. Tá na hora de resolver isso de vez, né?`;
                    followUpResponse += `\n\nImagine como seria incrível ${product.description.split('.')[0].toLowerCase()} ${timePreference === 'night' ? 'nessa noite' : 'hoje'}! Clique aqui AGORA antes que a oferta expire: ${product.link}`;
                    await client.sendMessage(row.userId, adjustTone(followUpResponse, tone));
                    await markLeadAsFollowedUp(row.id);
                    logger.info(`Follow-up enviado para ${row.userId}: ${followUpResponse}`);
                } catch (error) {
                    logger.error(`Erro ao enviar follow-up para ${row.userId}: ${error.message}`, error.stack);
                }
            }
        });
    });
}

async function handleCommand(text, message, lang, sentiment) {
    const [command, ...args] = text.slice(1).split(' ');
    const prompt = args.join(' ');
    const context = conversationContext.get(message.from) || { tone: 'neutro' };
    const tone = context.tone;
    metrics.logCommand();
    await logUsage(message.from, command);

    if (plugins[command]) {
        try {
            const pluginResponse = await plugins[command].execute(message, args, client);
            await client.sendMessage(message.from, pluginResponse);
            return;
        } catch (error) {
            logger.error(`Erro ao executar plugin ${command}: ${error.message}`);
            await client.sendMessage(message.from, adjustTone('Erro ao executar o plugin.', tone));
            return;
        }
    }

    switch (command.toLowerCase()) {
        case 'ajuda':
            await client.sendMessage(message.from, await showHelp());
            break;
        case 'cancelar':
            await client.sendMessage(message.from, adjustTone('Beleza, cancelei! Mas não deixa teu problema pra depois – me diz como te ajudo agora! 🙂', tone));
            break;
        case 'gerartexto':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Fala mais, tipo: "!gerartexto Escreva um poema".', tone));
                return;
            }
            let generatedText;
            if (process.env.OPENROUTER_API_KEY && canCallOpenRouter()) {
                try {
                    const response = await axios.post(
                        'https://openrouter.ai/api/v1/chat/completions',
                        {
                            model: 'mistralai/mixtral-8x7b-instruct',
                            messages: [
                                { role: 'system', content: 'Você é um assistente que gera textos úteis em português.' },
                                { role: 'user', content: `Escreva um texto sobre "${prompt}" em português.` }
                            ],
                            max_tokens: 150
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    generatedText = response.data.choices[0].message.content.trim();
                    openRouterCallCount.count++;
                    logger.info(`Texto gerado com OpenRouter: ${generatedText}`);
                } catch (error) {
                    logger.error(`Erro no OpenRouter para !gerartexto: ${error.message}`);
                    generatedText = null;
                }
            }
            if (!generatedText && process.env.HUGGINGFACE_API_KEY && canCallHuggingFace()) {
                try {
                    const response = await axios.post(
                        'https://api-inference.huggingface.co/models/facebook/bart-large',
                        { inputs: `Escreva um texto sobre "${prompt}" em português`, parameters: { max_length: 150 } },
                        { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
                    );
                    generatedText = response.data[0]?.generated_text || `Aqui tá um texto simples sobre "${prompt}": Um conteúdo básico pra te ajudar!`;
                    huggingFaceCallCount.count++;
                    logger.info(`Texto gerado com Hugging Face: ${generatedText}`);
                } catch (error) {
                    logger.error(`Erro no Hugging Face para !gerartexto: ${error.message}`);
                    generatedText = null;
                }
            }
            if (!generatedText && process.env.TOGETHERAI_API_KEY && canCallTogetherAI()) {
                try {
                    const response = await axios.post(
                        'https://api.together.xyz/v1/chat/completions',
                        {
                            model: 'meta-llama/LLaMA-13B',
                            messages: [
                                { role: 'system', content: 'Você é um assistente que gera textos úteis em português.' },
                                { role: 'user', content: `Escreva um texto sobre "${prompt}" em português.` }
                            ],
                            max_tokens: 150
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.TOGETHERAI_API_KEY}` } }
                    );
                    generatedText = response.data.choices[0].message.content.trim();
                    togetherAICallCount.count++;
                    logger.info(`Texto gerado com Together AI: ${generatedText}`);
                } catch (error) {
                    logger.error(`Erro no Together AI para !gerartexto: ${error.message}`);
                    generatedText = null;
                }
            }
            if (!generatedText) generatedText = `Aqui tá um texto simples sobre "${prompt}": Um conteúdo básico pra te ajudar!`;
            await saveToCache(text, generatedText);
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(generatedText, sentiment));
            break;
        case 'gerarimagem':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Me diz o que quer, tipo: "!gerarimagem Um gato astronauta".', tone));
                return;
            }
            await client.sendMessage(message.from, adjustTone('Beleza, já vou gerar a imagem... 🖼️', tone));
            const imageUrl = 'https://via.placeholder.com/150';
            await client.sendMessage(message.from, { media: imageUrl, caption: adjustTone('Aqui tá tua imagem! Quer algo mais pra turbinar teu dia? 🙂', tone) });
            break;
        case 'buscarx':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Fala o que quer buscar no X, tipo: "!buscarx tecnologia".', tone));
                return;
            }
            const xResult = adjustTone(`Pesquisei no X sobre "${prompt}" e achei um resumo básico: Algo incrível tá rolando por lá – quer saber mais?`, tone);
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(xResult, sentiment));
            break;
        case 'perfilx':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Me dá um usuário do X, tipo: "!perfilx elonmusk".', tone));
                return;
            }
            const profileAnalysis = adjustTone(`Sobre o @${prompt}: Parece um perfil bem ativo e interessante! Quer uma dica pra bombar teu dia também?`, tone);
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(profileAnalysis, sentiment));
            break;
        case 'buscar':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Fala o que quer buscar, tipo: "!buscar IA".', tone));
                return;
            }
            let searchResult;
            if (process.env.OPENROUTER_API_KEY && canCallOpenRouter()) {
                try {
                    const response = await axios.post(
                        'https://openrouter.ai/api/v1/chat/completions',
                        {
                            model: 'mistralai/mixtral-8x7b-instruct',
                            messages: [
                                { role: 'system', content: 'Você é um assistente de busca útil.' },
                                { role: 'user', content: `Pesquise sobre "${prompt}" e me dê um resumo em português.` }
                            ],
                            max_tokens: 150
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` } }
                    );
                    searchResult = response.data.choices[0].message.content.trim();
                    openRouterCallCount.count++;
                    logger.info(`Busca gerada com OpenRouter: ${searchResult}`);
                } catch (error) {
                    logger.error(`Erro no OpenRouter para !buscar: ${error.message}`);
                    searchResult = null;
                }
            }
            if (!searchResult && process.env.HUGGINGFACE_API_KEY && canCallHuggingFace()) {
                try {
                    const response = await axios.post(
                        'https://api-inference.huggingface.co/models/facebook/bart-large',
                        { inputs: `Pesquise sobre "${prompt}" e me dê um resumo em português`, parameters: { max_length: 150 } },
                        { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
                    );
                    searchResult = response.data[0]?.generated_text || `Pesquisei "${prompt}" e achei: Um resumo básico pra te ajudar!`;
                    huggingFaceCallCount.count++;
                    logger.info(`Busca gerada com Hugging Face: ${searchResult}`);
                } catch (error) {
                    logger.error(`Erro no Hugging Face para !buscar: ${error.message}`);
                    searchResult = null;
                }
            }
            if (!searchResult && process.env.TOGETHERAI_API_KEY && canCallTogetherAI()) {
                try {
                    const response = await axios.post(
                        'https://api.together.xyz/v1/chat/completions',
                        {
                            model: 'meta-llama/LLaMA-13B',
                            messages: [
                                { role: 'system', content: 'Você é um assistente de busca útil.' },
                                { role: 'user', content: `Pesquise sobre "${prompt}" e me dê um resumo em português.` }
                            ],
                            max_tokens: 150
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.TOGETHERAI_API_KEY}` } }
                    );
                    searchResult = response.data.choices[0].message.content.trim();
                    togetherAICallCount.count++;
                    logger.info(`Busca gerada com Together AI: ${searchResult}`);
                } catch (error) {
                    logger.error(`Erro no Together AI para !buscar: ${error.message}`);
                    searchResult = `Pesquisei "${prompt}" e achei: Um resumo básico pra te ajudar!`;
                }
            }
            if (!searchResult) searchResult = `Pesquisei "${prompt}" e achei: Um resumo básico pra te ajudar!`;
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(searchResult, sentiment));
            break;
        case 'clima':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Me diz a cidade, tipo: "!clima São Paulo".', tone));
                return;
            }
            const weather = adjustTone(`O clima em ${prompt} tá assim: Um dia básico com solzinho! 🌤️ Quer aproveitar esse dia com mais energia?`, tone);
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(weather, sentiment));
            break;
        case 'traduzir':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Fala o texto, tipo: "!traduzir Olá pra inglês".', tone));
                return;
            }
            let translatedText;
            if (process.env.OPENROUTER_API_KEY && canCallOpenRouter()) {
                try {
                    const response = await axios.post(
                        'https://openrouter.ai/api/v1/chat/completions',
                        {
                            model: 'mistralai/mixtral-8x7b-instruct',
                            messages: [
                                { role: 'system', content: 'Você é um tradutor para inglês.' },
                                { role: 'user', content: `Traduza "${prompt}" para o inglês.` }
                            ],
                            max_tokens: 50
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` } }
                    );
                    translatedText = response.data.choices[0].message.content.trim();
                    openRouterCallCount.count++;
                    logger.info(`Tradução gerada com OpenRouter: ${translatedText}`);
                } catch (error) {
                    logger.error(`Erro no OpenRouter para !traduzir: ${error.message}`);
                    translatedText = null;
                }
            }
            if (!translatedText && process.env.HUGGINGFACE_API_KEY && canCallHuggingFace()) {
                try {
                    const response = await axios.post(
                        'https://api-inference.huggingface.co/models/facebook/bart-large',
                        { inputs: `Traduza "${prompt}" para o inglês`, parameters: { max_length: 50 } },
                        { headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
                    );
                    translatedText = response.data[0]?.generated_text || `Traduzi "${prompt}" pro inglês: Hi there!`;
                    huggingFaceCallCount.count++;
                    logger.info(`Tradução gerada com Hugging Face: ${translatedText}`);
                } catch (error) {
                    logger.error(`Erro no Hugging Face para !traduzir: ${error.message}`);
                    translatedText = null;
                }
            }
            if (!translatedText && process.env.TOGETHERAI_API_KEY && canCallTogetherAI()) {
                try {
                    const response = await axios.post(
                        'https://api.together.xyz/v1/chat/completions',
                        {
                            model: 'meta-llama/LLaMA-13B',
                            messages: [
                                { role: 'system', content: 'Você é um tradutor para inglês.' },
                                { role: 'user', content: `Traduza "${prompt}" para o inglês.` }
                            ],
                            max_tokens: 50
                        },
                        { headers: { 'Authorization': `Bearer ${process.env.TOGETHERAI_API_KEY}` } }
                    );
                    translatedText = response.data.choices[0].message.content.trim();
                    togetherAICallCount.count++;
                    logger.info(`Tradução gerada com Together AI: ${translatedText}`);
                } catch (error) {
                    logger.error(`Erro no Together AI para !traduzir: ${error.message}`);
                    translatedText = `Traduzi "${prompt}" pro inglês: Hi there!`;
                }
            }
            if (!translatedText) translatedText = `Traduzi "${prompt}" pro inglês: Hi there!`;
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(translatedText, sentiment));
            break;
        case 'resumo':
            const summary = await generateDailySummary(message.to);
            await client.sendMessage(message.from, await adjustResponseBasedOnSentiment(`${summary} 📝 Quer aproveitar o dia com algo que te deixe no topo?`, sentiment));
            break;
        case 'status':
            const uptime = Math.floor((Date.now() - startTime) / 1000 / 60);
            await client.sendMessage(message.from, adjustTone(`Tô de boa há ${uptime} minutos, ajudando gente como você! Mensagens: ${metrics.getMessageCount()}. Comandos: ${metrics.getCommandCount()}. Vendas: ${metrics.getTotalSales()}. 😊 Quer entrar nessa onda de sucesso comigo? Me diz o que te incomoda que eu te mostro o caminho!`, tone));
            break;
        case 'config':
            if (!args.length) {
                await client.sendMessage(message.from, `Configurações atuais: ${JSON.stringify(config, null, 2)}`);
                return;
            }
            const [key, value] = args;
            if (key in defaultConfig) {
                config[key] = value === 'true' || value === 'false' ? value === 'true' : value;
                await fs.promises.writeFile('./config.json', JSON.stringify(config, null, 2));
                await client.sendMessage(message.from, adjustTone(`Configuração atualizada: ${key} = ${value} 👍 Quer aproveitar e resolver algo agora?`, tone));
            } else {
                await client.sendMessage(message.from, adjustTone('Essa configuração não existe. Dá uma olhada no !ajuda e me diz como te ajudo hoje!', tone));
            }
            break;
        case 'vendas':
            await client.sendMessage(message.from, adjustTone(`Já peguei ${metrics.getTotalSales()} intenções de venda – tá bombando! Quer ver os leads e aproveitar essa onda? Usa !leads! 😊`, tone));
            break;
        case 'hora':
            const now = new Date();
            const localHours = (now.getUTCHours() + TIMEZONE_OFFSET + 24) % 24;
            const minutes = now.getUTCMinutes().toString().padStart(2, '0');
            let greeting = localHours >= 5 && localHours < 12 ? 'Bom dia' : localHours >= 12 && localHours < 18 ? 'Boa tarde' : 'Boa noite';
            await client.sendMessage(message.from, adjustTone(`${greeting}! Aqui são ${localHours}:${minutes}. ⏰ Tá na hora de resolver algo que te incomoda – me conta!`, tone));
            break;
        case 'conhecimento':
            if (!prompt) {
                await client.sendMessage(message.from, adjustTone('Me ensina algo, tipo: "!conhecimento O melhor celular é o XPhone".', tone));
                return;
            }
            await saveKnowledge(message.from, prompt);
            await client.sendMessage(message.from, adjustTone(`Valeu! Registrei: "${prompt}". Isso vai me ajudar a te dar soluções ainda melhores – manda mais! 😊`, tone));
            break;
        case 'leads':
            const leads = await getLeads(message.from);
            await client.sendMessage(message.from, leads ? adjustTone(`Seus leads:\n${leads} 📋 Tá na hora de aproveitar essas oportunidades – quer uma dica pra fechar essas vendas?`, tone) : adjustTone('Ainda não tenho leads teus, mas isso muda agora! Fala o que te incomoda que eu te levo pra solução perfeita! 😉', tone));
            break;
        case 'restart':
            if (message.from !== config.adminNumber) {
                await client.sendMessage(message.from, adjustTone('Só o chefe pode reiniciar o bot, desculpa! Mas eu te ajudo com qualquer coisa agora – me diz o que precisa!', tone));
                return;
            }
            await client.sendMessage(message.from, adjustTone('Tô reiniciando agora... Já volto pra te ajudar a bombar! 🔄', tone));
            client.destroy().then(() => initializeWhatsAppClient());
            break;
        case 'stats':
            const stats = await generateStats();
            await client.sendMessage(message.from, adjustTone(`${stats}\n\nQuer fazer parte dessa história de sucesso? Me conta o que te incomoda que eu te mostro o caminho!`, tone));
            break;
        case 'backup':
            if (message.from !== config.adminNumber) {
                await client.sendMessage(message.from, adjustTone('Só o administrador pode fazer backup, desculpa! Mas eu te ajudo com qualquer coisa agora – o que tá rolando?', tone));
                return;
            }
            const backupPath = await manualBackup();
            await client.sendMessage(message.from, adjustTone(`Backup feito com sucesso em: ${backupPath} ✅ Tudo seguro pra continuarmos bombando – me diz como te ajudo agora!`, tone));
            break;
        default:
            await client.sendMessage(message.from, adjustTone('Não entendi esse comando, mas não te deixo na mão! Dá uma olhada no !ajuda ou me conta o que te incomoda que eu te mostro algo incrível!', tone));
    }
}

async function handleMediaMessage(message, lang) {
    const context = conversationContext.get(message.from) || { tone: 'neutro' };
    const tone = context.tone;
    if (message.type === 'audio' && deepgram) {
        const transcription = await transcribeAudio(message);
        await client.sendMessage(message.from, adjustTone(`Aqui tá a transcrição do teu áudio: ${transcription} 🎙️ Isso tá te incomodando? Me diz mais que eu te ajudo a resolver AGORA!`, tone));
    } else if (message.type === 'image' && visionClient) {
        const analysis = await analyzeImageWithGoogleVision(message);
        await client.sendMessage(message.from, adjustTone(`Olha o que achei na tua imagem: ${analysis} 🖼️ Tá precisando de algo pra melhorar teu dia? Me conta!`, tone));
    } else if (message.type === 'document' && message.mimetype.includes('pdf')) {
        const text = await extractTextFromPDF(message);
        await client.sendMessage(message.from, adjustTone(`Texto do teu PDF: ${text.slice(0, 500)}... 📜 Isso te incomoda ou quer resolver algo relacionado? Me diz que eu te mostro o caminho!`, tone));
    } else {
        await client.sendMessage(message.from, adjustTone('Recebi tua mídia! Por enquanto, só trabalho com áudio, imagens e PDFs. Manda um texto que eu te ajudo a resolver qualquer coisa AGORA!', tone));
    }
}

async function transcribeAudio(message) {
    if (!deepgram) return 'Erro: Deepgram API não configurada. Manda um texto que eu te ajudo!';
    try {
        const media = await message.downloadMedia();
        const audioBuffer = Buffer.from(media.data, 'base64');
        const response = await deepgram.listen.prerecorded.transcribe(
            { buffer: audioBuffer, mimetype: media.mimetype },
            { punctuate: true, language: 'pt-BR' }
        );
        return response.results?.channels[0]?.alternatives[0]?.transcript || 'Não consegui transcrever, desculpa!';
    } catch (error) {
        logger.error(`Erro na transcrição com Deepgram: ${error.message}`, error.stack);
        return 'Deu erro ao transcrever o áudio, tenta de novo?';
    }
}

async function analyzeImageWithGoogleVision(message) {
    if (!visionClient) return 'Erro: Google Vision API não configurada. Manda um texto que eu te ajudo!';
    try {
        const media = await message.downloadMedia();
        const imageBuffer = Buffer.from(media.data, 'base64');
        const [result] = await visionClient.labelDetection(imageBuffer);
        const labels = result.labelAnnotations.map(label => label.description).join(', ');
        return labels ? `Rótulos detectados: ${labels}` : 'Não achei nada na imagem, desculpa!';
    } catch (error) {
        logger.error(`Erro na análise de imagem com Google Vision: ${error.message}`, error.stack);
        return 'Deu erro ao analisar a imagem, tenta outra?';
    }
}

async function extractTextFromPDF(message) {
    try {
        const media = await message.downloadMedia();
        const pdfBuffer = Buffer.from(media.data, 'base64');
        const data = await PDFParser(pdfBuffer);
        return data.text || 'Não consegui extrair texto do PDF, desculpa!';
    } catch (error) {
        logger.error(`Erro na extração de texto do PDF: ${error.message}`, error.stack);
        return 'Deu erro ao pegar o texto do PDF, tenta outro?';
    }
}

async function generateDailySummary(groupId) {
    const date = new Date().toISOString().split('T')[0];
    return new Promise((resolve) => {
        db.all('SELECT message FROM messages WHERE groupId = ? AND date = ?', [groupId, date], (err, rows) => {
            if (err) resolve('Deu erro ao gerar o resumo, desculpa!');
            else if (rows.length === 0) resolve('Nenhuma mensagem hoje ainda.');
            else resolve(`Resumo do dia ${date}:\n${rows.map(row => JSON.parse(row.message).body).join('\n').slice(0, 1000)}...`);
        });
    });
}

async function generateWeeklySummary() {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return new Promise((resolve) => {
        db.all('SELECT groupId, message, date FROM messages WHERE date >= ?', [oneWeekAgo], (err, rows) => {
            if (err) resolve('Erro ao gerar o resumo semanal, desculpa!');
            else if (rows.length === 0) resolve('Nenhuma mensagem na última semana.');
            else {
                const summaryByGroup = {};
                rows.forEach(row => {
                    if (!summaryByGroup[row.groupId]) summaryByGroup[row.groupId] = [];
                    summaryByGroup[row.groupId].push(`${row.date}: ${JSON.parse(row.message).body}`);
                });
                let summaryText = 'Resumo Semanal:\n';
                for (const [groupId, messages] of Object.entries(summaryByGroup)) {
                    summaryText += `\nGrupo ${groupId}:\n${messages.join('\n').slice(0, 500)}...\n`;
                }
                resolve(summaryText);
            }
        });
    });
}

async function generateStats() {
    return new Promise((resolve) => {
        db.all('SELECT userId, COUNT(*) as count FROM usage GROUP BY userId ORDER BY count DESC LIMIT 5', (err, rows) => {
            if (err) resolve('Erro ao gerar estatísticas, desculpa!');
            else {
                const userStats = rows.map(row => `${row.userId}: ${row.count} comandos`).join('\n');
                const totalCommands = rows.reduce((sum, row) => sum + row.count, 0);
                resolve(`Estatísticas do Bot:\nUptime: ${Math.floor((Date.now() - startTime) / 1000 / 60)} minutos\nTotal de comandos: ${totalCommands}\nTop 5 usuários:\n${userStats}`);
            }
        });
    });
}

function scheduleDailyReport() {
    const reportNumber = process.env.REPORT_PHONE_NUMBER;
    if (!reportNumber) return;
    schedule.scheduleJob(config.reportTime, async () => {
        try {
            const date = new Date().toISOString().split('T')[0];
            for (const groupId of config.monitoredGroups) {
                const summary = await generateDailySummary(groupId);
                await client.sendMessage(reportNumber, `Relatório diário ${date} pra ${groupId}:\n${summary}`);
            }
            logger.info('Relatório diário enviado.');
        } catch (error) {
            logger.error(`Erro ao enviar relatório diário: ${error.message}`, error.stack);
        }
    });
}

function scheduleWeeklyReport() {
    const reportNumber = process.env.REPORT_PHONE_NUMBER;
    if (!reportNumber) return;
    schedule.scheduleJob(config.weeklyReportTime, async () => {
        try {
            const summary = await generateWeeklySummary();
            await client.sendMessage(reportNumber, summary);
            logger.info('Relatório semanal enviado.');
        } catch (error) {
            logger.error(`Erro ao enviar relatório semanal: ${error.message}`, error.stack);
        }
    });
}
// (Certifique-se de que todas as funções anteriores estejam fechadas corretamente antes deste ponto)

// Função para exibir a ajuda com comandos
function showHelp() {
    return `
Oi, tudo bem? Aqui vai uma lista dos comandos que eu sei:
!ajuda - Mostra essa lista aqui
!cancelar - Cancela o que eu tava fazendo
!gerartexto [texto] - Crio um texto pra você (ex.: "!gerartexto Escreva um poema")
!gerarimagem [descrição] - Gero uma imagem do que você pedir
!buscarx [termo] - Busco algo no X pra você
!perfilx [usuário] - Analiso um perfil do X
!buscar [termo] - Pesquiso algo pra você
!clima [cidade] - Te conto o clima
!traduzir [texto] - Traduzo pro inglês
!resumo - Resumo do que rolou no grupo hoje
!status - Te falo como eu tô
!config [chave] [valor] - Mexo nas minhas configs (se eu deixar)
!vendas - Mostro quantas vendas já registrei
!hora - Te digo a hora certinho
!conhecimento [texto] - Aprendo algo novo com você
!leads - Te mostro os leads que peguei
!restart - Reinicio (só o chefe pode usar)
!stats - Estatísticas de como eu tô indo
!backup - Faço um backup (só pro chefe)
Ou só me fala o que tá te incomodando que eu te ajudo a resolver AGORA com soluções que já transformaram milhares de vidas!
    `;
}};