const fs = require('fs');
const path = require('path');
const spawn = require('child_process').spawn;
const Excel = require('exceljs');

async function getPackageNames(source) {
    const files = fs.readdirSync(source);
    return files;
}

async function getRepositoryRootPath() {
    const { stdout } = await runCommand(['git', 'rev-parse', '--show-toplevel']);
    return stdout.trim();
}

async function runCommand(args, opts = {}) {
    const command = args[0];
    const commandArgs = args.slice(1);

    return new Promise((resolve, reject) => {
        const stdoutBuffer = [];
        const stderrBuffer = [];

        try {
            const childProcess = spawn(command, commandArgs, { ...opts });
            childProcess.stdout.on('data', (data) => stdoutBuffer.push(data));
            childProcess.stderr.on('data', (data) => stderrBuffer.push(data));

            childProcess.on('close', (code) => {
                resolve({
                    code,
                    stdout: stdoutBuffer.join(""),
                    stderr: stderrBuffer.join("")
                });
            });
        } catch (e) {
            reject(e);
        }
    });
}

function getDependencies(source) {
    const packageJsonPath = path.normalize(path.join(source, 'package.json'));
    const packageJson = require(packageJsonPath)
    return packageJson;
}

function generateGlobalPackageList(data, dependencyType) {
    let dependencyNames = [];
    for (const packageName in data) {
        const dependencies = data[packageName][dependencyType] || {};
        dependencyNames = dependencyNames.concat(Object.keys(dependencies))
    }

    dependencyNames = [... new Set(dependencyNames)];
    return dependencyNames;
}

function generateVersionData(data, dependencyType) {
    const results = {};
    const dependencyNames = generateGlobalPackageList(data, dependencyType);

    for (const packageName in data) {
        const dependencies = data[packageName][dependencyType] || {};

        results[packageName] = {};
        for (const dependencyName of dependencyNames) {
            const dependencyVersion = dependencies[dependencyName]
            results[packageName][dependencyName] = dependencyVersion;
        }
    }

    return results;
}

function generateReport(data) {

    const report = {};
    const dependencyTypes = ['dependencies', 'devDependencies', 'peerDependencies'];
    for (const dependencyType of dependencyTypes) {
        const versionData = generateVersionData(data, dependencyType);

        report[dependencyType] = versionData;
    }

    return report;
}

async function exportToExcel(data, filename) {
    const workbook = new Excel.Workbook();

    for (const dependencyType in data) {
        const sheet = workbook.addWorksheet(dependencyType);
        sheet.views = [
            { state: 'frozen', xSplit: 1, ySplit: 1 }
        ];

        let rows = [];

        const packageNames = Object.keys(data[dependencyType]);

        const firstPackageName = packageNames.length ? packageNames[0] : null;
        let dependencyNames = firstPackageName ?
            Object.keys(data[dependencyType][firstPackageName]) :
            [];
        dependencyNames = dependencyNames.sort();

        // generate header
        const headerRow = ['', ...dependencyNames];
        rows.push(headerRow);

        // generate version counts
        const versionCountRow = ['version_count']
        for (const dependencyName of dependencyNames) {
            let versions = [];
            for (const packageName of packageNames) {
                const packageDependencies = data[dependencyType][packageName];
                const dependencyVersion = packageDependencies[dependencyName];
                if (dependencyVersion) {
                    versions.push(dependencyVersion);
                }
            }
            versions = [... new Set(versions)];
            versionCountRow.push(versions.length)
        }
        rows.push(versionCountRow);

        // per-package rows
        for (const packageName of packageNames) {
            const packageDependencies = data[dependencyType][packageName];
            const packageDependencyVersions = dependencyNames.map((dependencyName) => packageDependencies[dependencyName])
            const row = [packageName].concat(packageDependencyVersions)
            rows.push(row);
        }

        sheet.insertRows(1, rows);
    }

    await workbook.xlsx.writeFile(filename);

}

async function main(props) {
    const reportFilename = props.output;
    const rootPaths = props.source;
    const results = {};

    for (const rootPath of rootPaths) {
        const packagesPath = path.join(rootPath, 'packages');
        let packageNames;
        try {
            packageNames = await getPackageNames(packagesPath);
        } catch (e) {
            packageNames = [];
            console.warn(`skipping packages ${packagesPath} - ${e}`);
        }

        // monorepo's can have root/global deps
        const rootPackageName = 'root:' + path.basename(rootPath);
        try {
            results[rootPackageName] = getDependencies(rootPath);
        } catch (e) {
            console.warn(`skipping repo ${rootPackageName} - ${e}`);
        }

        for (let i = 0; i < packageNames.length; i++) {
            const packageName = packageNames[i];
            const packagePath = path.join(packagesPath, packageName);

            console.log(`[${i + 1}/${packageNames.length}] ${packageName}`);
            try {
                const packageJson = getDependencies(packagePath);
                results[packageName] = packageJson;
            } catch (e) {
                console.error(e.message);
            }
        }
    }

    const report = generateReport(results);

    await exportToExcel(report, reportFilename);

    console.log(Object.keys(report).map((it) => `* ${it}`).join(`\n`));
    console.log('processed ' + Object.keys(report).length + ' packages.');
}


var myArgs = process.argv.slice(2);

const repositoryPaths = myArgs.slice(1);
const filename = myArgs[0];


main({ source: repositoryPaths, output: filename }).catch(console.error);
