const fs = require('fs');
const path = require('path');
const mock = require('mock-require');

// Mocka o Express antes de qualquer carregamento do index.js
mock('express', () => {
    const expressMock = () => {
        const app = {
            use: function (middleware) {
                // Simula o comportamento de app.use, aceitando middlewares como bodyParser
                this.middleware = this.middleware || [];
                if (typeof middleware === 'function') {
                    this.middleware.push(middleware);
                }
                return this;
            },
            get: function (path, handler) {
                // Simula rotas GET
                this.routes = this.routes || {};
                this.routes[path] = handler;
                return this;
            },
            listen: function (port, callback) {
                console.log(`[MOCK] Servidor Express não iniciado na porta ${port} durante o teste`);
                if (callback) callback();
                return { close: () => {} };
            },
            // Mock para bodyParser.json()
            json: () => (req, res, next) => next(),
            // Mock para bodyParser.urlencoded()
            urlencoded: () => (req, res, next) => next()
        };
        return app;
    };
    expressMock.Router = () => ({ get: () => {}, post: () => {} }); // Mock para Router
    return expressMock;
});

// Limpa o cache do index.js para garantir que ele use o mock
delete require.cache[require.resolve('./index.js')];

// Carrega o bot após configurar o mock
const bot = require('./index.js');

// Configuração para simulação
const TEST_USERS = [
    { id: 'user1@test.com', isAdmin: true },
    { id: 'user2@test.com', isAdmin: false },
    { id: 'user3@test.com', isAdmin: false }
];
const TEST_GROUP = 'testgroup@g.us';
const MESSAGE_COUNT = 350;
const DELAY_MS = 100;

// Função para simular uma mensagem do WhatsApp
function createMockMessage(userId, body, to = TEST_GROUP) {
    return {
        from: userId,
        to: to,
        body: body,
        hasMedia: false,
        downloadMedia: async () => ({ data: Buffer.from('mock media').toString('base64'), mimetype: 'text/plain' }),
        reply: async (text) => console.log(`[REPLY from ${userId}]: ${text}`)
    };
}

// Lista de comandos para teste (nativos)
const TEST_COMMANDS = [
    '!ajuda',
    '!gerartexto grok Teste de texto',
    '!gerarimagem Gato voador',
    '!buscarx tecnologia',
    '!perfilx elonmusk',
    '!buscar inteligência artificial',
    '!clima São Paulo',
    '!traduzir Olá para inglês',
    '!resumo',
    '!status',
    '!config autoReply false',
    '!vendas',
    '!hora',
    '!conhecimento O céu é azul',
    '!leads',
    '!restart',
    '!stats',
    '!backup'
];

// Função para simular envio de mídia
function createMockMediaMessage(userId, type) {
    return {
        from: userId,
        to: TEST_GROUP,
        body: '',
        hasMedia: true,
        type: type,
        mimetype: type === 'audio' ? 'audio/mpeg' : type === 'image' ? 'image/jpeg' : 'application/pdf',
        downloadMedia: async () => ({ data: Buffer.from(`mock ${type}`).toString('base64'), mimetype: type === 'audio' ? 'audio/mpeg' : type === 'image' ? 'image/jpeg' : 'application/pdf' })
    };
}

// Função para executar um teste de carga
async function runStressTest() {
    console.log(`Iniciando teste de carga com ${TEST_USERS.length} usuários e ${MESSAGE_COUNT} mensagens cada...`);

    // Simula desconexão
    console.log('Simulando desconexão...');
    await bot.scheduleReconnect();

    const promises = [];

    for (const user of TEST_USERS) {
        for (let i = 0; i < MESSAGE_COUNT; i++) {
            const isCommand = Math.random() > 0.3;
            const isMedia = Math.random() > 0.8;
            let mockMessage;

            if (isMedia) {
                const mediaType = ['audio', 'image', 'document'][Math.floor(Math.random() * 3)];
                mockMessage = createMockMediaMessage(user.id, mediaType);
                console.log(`[SENT from ${user.id}]: Media (${mediaType})`);
                promises.push(bot.handleMediaMessage(mockMessage, 'pt'));
            } else if (isCommand) {
                const command = TEST_COMMANDS[Math.floor(Math.random() * TEST_COMMANDS.length)];
                mockMessage = createMockMessage(user.id, command);
                console.log(`[SENT from ${user.id}]: ${command}`);
                promises.push(bot.handleCommand(command, mockMessage, 'pt', 'neutro'));
            } else {
                const text = `Mensagem de teste ${i} de ${user.id}`;
                mockMessage = createMockMessage(user.id, text);
                console.log(`[SENT from ${user.id}]: ${text}`);
                if (bot.config.autoReply) {
                    const product = bot.findRelevantProduct(text);
                    const tone = bot.detectTone(text);
                    let response = '';
                    if (product) {
                        response = product.campaignMessages[tone].replace('[link]', product.link);
                    } else {
                        response = bot.simpleResponses['pt'][Math.floor(Math.random() * bot.simpleResponses['pt'].length)];
                        response = await bot.adjustResponseBasedOnSentiment(response, 'neutro');
                    }
                    promises.push(bot.client.sendMessage(user.id, bot.adjustTone(response, tone)));
                }
            }

            if (user.isAdmin) {
                bot.config.adminNumber = user.id;
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    await Promise.all(promises);
    console.log('Teste de carga concluído!');

    console.log('Testando relatórios...');
    await bot.scheduleDailyReport();
    await bot.scheduleWeeklyReport();

    if (TEST_USERS.some(u => u.isAdmin)) {
        const admin = TEST_USERS.find(u => u.isAdmin);
        const backupMessage = createMockMessage(admin.id, '!backup');
        await bot.handleCommand(backupMessage.body, backupMessage, 'pt', 'neutro');
    }

    console.log('Testando limite de taxa...');
    for (let i = 0; i < 15; i++) {
        const rateTestMessage = createMockMessage(TEST_USERS[0].id, '!status');
        await bot.handleCommand(rateTestMessage.body, rateTestMessage, 'pt', 'neutro');
    }

    console.log('Teste completo! Verifique os logs e saídas acima.');
}

// Mock para o cliente WhatsApp
bot.client = {
    sendMessage: async (to, text) => console.log(`[MOCK SEND to ${to}]: ${text}`),
    getChatById: async () => ({
        isGroup: true,
        name: 'Test Group',
        id: { _serialized: TEST_GROUP },
        participants: TEST_USERS.map(u => ({ id: { _serialized: u.id }, isAdmin: u.isAdmin }))
    }),
    destroy: async () => console.log('Cliente destruído (mock)'),
    initialize: async () => console.log('Cliente inicializado (mock)')
};

// Executa o teste
runStressTest().catch(err => console.error('Erro no teste:', err));
