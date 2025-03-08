const sentimentCommand = require('./sentimentCommand');
const translateCommand = require('./translateCommand');
const logger = require('../utils/logger');

// Função para lidar com comandos
async function handleCommand(commandText, message) {
    const args = commandText.split(' ').slice(1); // Pega os argumentos após o comando
    const command = commandText.split(' ')[0].toLowerCase(); // Extrai o nome do comando

    try {
        switch (command) {
            case '!sentimento':
                await sentimentCommand.execute(args.join(' '), message);
                break;

            case '!traduzir':
                await translateCommand.execute(args.join(' '), message);
                break;

            case '!ajuda':
                await showHelp(message); // Chama a função de ajuda
                break;

            case '!status':
                await statusCommand(message);
                break;

            case '!relatorio':
                await reportCommand(message);
                break;

            default:
                await message.reply('Comando não reconhecido. Use !ajuda para ver a lista de comandos.');
                break;
        }
    } catch (error) {
        logger.error('Erro ao processar comando:', error.message);
        await message.reply('Desculpe, ocorreu um erro ao processar o comando.');
    }
}

// Comando de Status
async function statusCommand(message) {
    await message.reply('🤖 Bot online e funcionando normalmente!');
}

// Comando de Relatório
async function reportCommand(message) {
    const reportMessage = `
    📊 Relatório de Atividades:
    - Total de vendas processadas: ${global.totalSales || 0}
    - Última reinicialização: ${new Date().toLocaleString()}
    `;
    await message.reply(reportMessage);
}

// Função de ajuda
async function showHelp(message) {
    const helpMessage = `
    🤖 **Comandos disponíveis:**
    
    - **!cancelar**: Cancela o comando atual.
    
    - **!ajuda**: Mostra essa mensagem de ajuda.
    
    - **!gerarTexto [prompt]**: Gera um texto com seu prompt.
    
    - **!sentimento [texto]**: Analisa o sentimento do texto fornecido.
    
    - **!traduzir [texto]**: Traduz o texto fornecido.
    
    - **!status**: Mostra o status atual do bot.
    
    - **!relatorio**: Mostra um relatório de atividades.
    
    Se você precisa de ajuda adicional, não hesite em perguntar!
    `;
    
    await message.reply(helpMessage);
}

module.exports = {
    handleCommand,
};