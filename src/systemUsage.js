import GLib from 'gi://GLib';

// Dois segundos: o suficiente para a leitura acompanhar um pico e não tanto
// que a barra vire uma animação no canto do olho. O valor de CPU é sempre a
// média DESTE intervalo — não há amostragem mais fina por trás.
const INTERVAL_SECONDS = 2;

const DECODER = new TextDecoder();

// O /proc é virtual: a leitura não toca em disco e o conteúdo é montado na
// hora pelo kernel, então ler síncrono aqui custa menos que armar um
// GFile assíncrono a cada dois segundos.
function readProc(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? DECODER.decode(bytes) : '';
    } catch (e) {
        logError(e, `[ArcBar] leitura de ${path} falhou`);
        return '';
    }
}

function percent(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Uso de CPU e de memória, lido do /proc num intervalo fixo.
 *
 * Como os outros modelos da extensão, não guarda cópia de nada que o sistema
 * já saiba — a única memória que ele tem é a amostra anterior do /proc/stat,
 * que existe porque lá os números são contadores desde o boot: uso de CPU só
 * aparece na DIFERENÇA entre duas leituras.
 */
export class SystemUsage {
    constructor({ onChanged }) {
        this._onChanged = onChanged;
        this._timeoutId = 0;
        this._previousCpu = null;

        this.cpu = 0;
        this.memory = 0;
    }

    enable() {
        this._update();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, INTERVAL_SECONDS, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }

    destroy() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._onChanged = null;
    }

    _update() {
        this.cpu = this._readCpu();
        this.memory = this._readMemory();
        this._onChanged?.();
    }

    // A primeira linha do /proc/stat é a soma de todos os núcleos:
    // "cpu  user nice system idle iowait irq softirq steal guest guest_nice".
    _readCpu() {
        const line = readProc('/proc/stat').split('\n', 1)[0] ?? '';
        const values = line.trim().split(/\s+/).slice(1).map(Number).filter(Number.isFinite);
        if (values.length < 5)
            return this.cpu;

        // iowait conta como ocioso: a máquina está esperando o disco, não
        // calculando — somá-lo ao uso faria uma cópia de arquivos parecer
        // 100% de CPU.
        const idle = values[3] + values[4];
        const total = values.reduce((sum, value) => sum + value, 0);
        const previous = this._previousCpu;
        this._previousCpu = { idle, total };

        // Sem amostra anterior (a primeira leitura, logo no enable()) o que
        // dá para mostrar é a média desde o boot. É um número morno, mas
        // honesto — e some no primeiro tique, dois segundos depois. Mostrar
        // 0% até lá seria inventar um valor.
        if (!previous)
            return percent(total ? (total - idle) / total * 100 : 0);

        const deltaTotal = total - previous.total;
        const deltaIdle = idle - previous.idle;
        if (deltaTotal <= 0)
            return this.cpu;

        return percent((deltaTotal - deltaIdle) / deltaTotal * 100);
    }

    // MemAvailable é a estimativa do próprio kernel de quanto dá para abrir
    // um app novo sem swap — o que "memória livre" quer dizer para quem olha
    // a barra. MemFree sozinho contaria todo o cache de disco como ocupado e
    // marcaria ~100% em qualquer máquina ligada há um tempo.
    _readMemory() {
        const meminfo = readProc('/proc/meminfo');
        const field = name => {
            const match = meminfo.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
            return match ? Number(match[1]) : 0;
        };

        const total = field('MemTotal');
        if (!total)
            return this.memory;

        // MemAvailable existe desde o kernel 3.14; a soma abaixo é a conta
        // que se fazia antes dele, guardada só para não haver um caso em que
        // a linha mostre 100% sem motivo.
        const available = field('MemAvailable') ||
            (field('MemFree') + field('Buffers') + field('Cached'));

        return percent((total - available) / total * 100);
    }
}
