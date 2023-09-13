"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const toolLib = __importStar(require("azure-pipelines-tool-lib"));
const tl = require("azure-pipelines-task-lib");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const util = __importStar(require("util"));
const compare_versions_1 = require("compare-versions");
const osPlat = os.platform();
const osArch = os.arch();
const cacheKey = 'hugo';
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            tl.setResourcePath(path.join(__dirname, "task.json"));
            // download version
            const hugoVersion = tl.getInput("hugoVersion", false);
            const extendedVersion = tl.getBoolInput('extendedVersion', false);
            yield getHugo(hugoVersion, extendedVersion);
            const source = tl.getPathInput('source', true, false);
            const destination = tl.getPathInput('destination', true, false);
            const baseURL = tl.getInput('baseURL', false);
            const buildDrafts = tl.getBoolInput('buildDrafts', false);
            const buildExpired = tl.getBoolInput('buildExpired', false);
            const buildFuture = tl.getBoolInput('buildFuture', false);
            const minify = tl.getBoolInput('minify', false);
            const additionalArgs = tl.getInput('additionalArgs', false);
            const hugoPath = tl.which(cacheKey, true);
            const hugo = tl.tool(hugoPath);
            hugo.argIf(source, ['--source', source]);
            hugo.argIf(destination, ['--destination', destination]);
            hugo.argIf(baseURL, ['--baseURL', baseURL]);
            hugo.argIf(buildDrafts, '--buildDrafts');
            hugo.argIf(buildExpired, '--buildExpired');
            hugo.argIf(buildFuture, '--buildFuture');
            hugo.argIf(minify, '--minify');
            // implicit flags
            hugo.line(' --printI18nWarnings --printPathWarnings --enableGitInfo --verbose');
            if (additionalArgs) {
                hugo.line(additionalArgs);
            }
            yield hugo.exec();
        }
        catch (error) {
            tl.setResult(tl.TaskResult.Failed, error);
        }
    });
}
function getHugo(version, extendedVersion) {
    return __awaiter(this, void 0, void 0, function* () {
        const latest = 'latest';
        if (!version) {
            version = latest;
        }
        if (version !== latest) {
            version = sanitizeVersionString(version);
        }
        if (version == latest) {
            version = yield getLatestGitHubRelease();
        }
        // check cache
        let toolPath;
        toolPath = toolLib.findLocalTool(cacheKey, version);
        if (!toolPath) {
            // download, extract, cache
            toolPath = yield acquireHugo(version, extendedVersion);
            tl.debug("Hugo tool is cached under " + toolPath);
        }
        // prepend the tools path. instructs the agent to prepend for future tasks
        toolLib.prependPath(toolPath);
    });
}
const defaultHugoVersion = '0.91.2';
function getLatestGitHubRelease() {
    return __awaiter(this, void 0, void 0, function* () {
        const latestReleaseUrl = 'https://api.github.com/repos/gohugoio/hugo/releases/latest?draft=false';
        let latestVersion = defaultHugoVersion;
        // TODO At most once a day? where to cache whether run today?
        try {
            const downloadPath = yield toolLib.downloadTool(latestReleaseUrl);
            const response = JSON.parse(fs.readFileSync(downloadPath, 'utf8').toString().trim());
            if (response.tag_name) {
                latestVersion = response.tag_name.substring(1); // skip 'v' prefix
            }
        }
        catch (error) {
            tl.warning(util.format('Error while fetching Latest version from %s, assuming %s: %s', latestReleaseUrl, latestVersion, error));
        }
        return latestVersion;
    });
}
function acquireHugo(version, extendedVersion) {
    return __awaiter(this, void 0, void 0, function* () {
        //
        // Download - a tool installer intimately knows how to get the tool (and construct urls)
        //
        const fileName = getFileName(version, extendedVersion);
        const downloadUrl = getDownloadUrl(version, fileName);
        let downloadPath;
        try {
            downloadPath = yield toolLib.downloadTool(downloadUrl);
            // TODO check SHA
        }
        catch (error) {
            tl.debug(error);
            // cannot localize the string here because to localize we need to set the resource file.
            // which can be set only once. azure-pipelines-tool-lib/tool, is already setting it to different file.
            // So left with no option but to hardcode the string. Other tasks are doing the same.
            throw (util.format("Failed to download version %s. Please verify that the version is valid and resolve any other issues. %s", version, error));
        }
        //make sure agent version is latest then 2.115.0
        tl.assertAgent('2.105.7');
        // Extract
        let extPath;
        extPath = tl.getVariable('Agent.TempDirectory');
        if (!extPath) {
            throw new Error("Expected Agent.TempDirectory to be set");
        }
        if (osPlat == 'win32') {
            extPath = yield toolLib.extractZip(downloadPath);
        }
        else {
            extPath = yield toolLib.extractTar(downloadPath);
        }
        // Install into the local tool cache - node extracts with a root folder that matches the fileName downloaded
        return yield toolLib.cacheDir(extPath, cacheKey, version);
    });
}
function getFileName(version, extendedVersion) {
    let platform = getOSPlatformName();
    let arch = (0, compare_versions_1.compare)(version, '0.103.0', '>=') ? getArchName() : getArchNameOld();
    const ext = osPlat == "win32" ? "zip" : "tar.gz";
    const filename = extendedVersion
        ? util.format("hugo_extended_%s_%s-%s.%s", version, platform, arch, ext)
        : util.format("hugo_%s_%s-%s.%s", version, platform, arch, ext);
    return filename;
}
function getOSPlatformName() {
    let platform = osPlat;
    // 'aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', and 'win32'.
    switch (osPlat) {
        case 'win32':
            platform = 'windows';
            break;
        case 'darwin':
            platform = 'macOS';
            break;
    }
    return platform;
}
function getArchName() {
    let arch = osArch;
    // 'arm', 'arm64', 'ia32', 'mips', 'mipsel', 'ppc', 'ppc64', 's390', 's390x', 'x32', and 'x64'.
    switch (osArch) {
        case 'x64':
            arch = 'amd64';
            break;
        case 'ia32':
        case 'x32':
            arch = '32bit';
            break;
    }
    return arch;
}
function getArchNameOld() {
    let arch = osArch;
    // 'arm', 'arm64', 'ia32', 'mips', 'mipsel', 'ppc', 'ppc64', 's390', 's390x', 'x32', and 'x64'.
    switch (osArch) {
        case 'x64':
            arch = '64bit';
            break;
        case 'ia32':
        case 'x32':
            arch = '32bit';
            break;
    }
    return arch;
}
function getDownloadUrl(version, filename) {
    return util.format("https://github.com/gohugoio/hugo/releases/download/v%s/%s", version, filename);
}
// handle user input scenerios
function sanitizeVersionString(inputVersion) {
    const version = toolLib.cleanVersion(inputVersion);
    if (!version) {
        throw new Error(tl.loc("NotAValidSemverVersion"));
    }
    return version;
}
run();
