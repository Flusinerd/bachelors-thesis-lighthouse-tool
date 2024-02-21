import * as chromeLauncher from 'chrome-launcher'
import * as cliProgress from 'cli-progress'
import * as fs from 'fs/promises'
import lighthouse, { Result, ScreenEmulationSettings, ThrottlingSettings } from 'lighthouse'
import { resultToCsv } from './results-parser'

const targets = ['http://localhost:5173', 'http://localhost:3000']
const pages = ['']
// const pages = ['', 'products/00d66fc6-f325-4872-9526-90a341476f7e']
const apiDelay = 500;
const runsPerPage = 10;

/**
 * Adjustments needed for DevTools network throttling to simulate
 * more realistic network conditions.
 * @see https://crbug.com/721112
 * @see https://docs.google.com/document/d/10lfVdS1iDWCRKQXPfbxEn4Or99D64mvNlugP1AQuFlE/edit
 */
const DEVTOOLS_RTT_ADJUSTMENT_FACTOR = 3.75;
const DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR = 0.9;


/**
 * Desktop metrics adapted from emulated_devices/module.json
 */
const DESKTOP_EMULATION_METRICS: ScreenEmulationSettings = {
  mobile: false,
  width: 1350,
  height: 940,
  deviceScaleFactor: 1,
  disabled: false,
};

/**
 * Mobile metrics adapted from emulated_devices/module.json
 */
const MOTOGPOWER_EMULATION_METRICS = {
  mobile: true,
  width: 412,
  height: 823,
  // This value has some interesting ramifications for image-size-responsive, see:
  // https://github.com/GoogleChrome/lighthouse/issues/10741#issuecomment-626903508
  deviceScaleFactor: 1.75,
  disabled: false,
};

const throttlingSettings: Record<string, { throttling: ThrottlingSettings, emulation: ScreenEmulationSettings }> = {
  desktopDense4G: {
    throttling: {
      rttMs: 40,
      throughputKbps: 10 * 1024,
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0, // 0 means unset
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
    }, emulation: DESKTOP_EMULATION_METRICS
  },
  // These values align with WebPageTest's definition of "Fast 3G"
  // But offer similar characteristics to roughly the 75th percentile of 4G connections.
  mobileSlow4G: {
    throttling: {
      rttMs: 150,
      throughputKbps: 1.6 * 1024,
      requestLatencyMs: 150 * DEVTOOLS_RTT_ADJUSTMENT_FACTOR,
      downloadThroughputKbps: 1.6 * 1024 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR,
      uploadThroughputKbps: 750 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR,
      cpuSlowdownMultiplier: 4,
    },
    emulation: MOTOGPOWER_EMULATION_METRICS,

  },
  // These values partially align with WebPageTest's definition of "Regular 3G".
  // These values are meant to roughly align with Chrome UX report's 3G definition which are based
  // on HTTP RTT of 300-1400ms and downlink throughput of <700kbps.
  mobileRegular3G: {
    throttling: {
      rttMs: 300,
      throughputKbps: 700,
      requestLatencyMs: 300 * DEVTOOLS_RTT_ADJUSTMENT_FACTOR,
      downloadThroughputKbps: 700 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR,
      uploadThroughputKbps: 700 * DEVTOOLS_THROUGHPUT_ADJUSTMENT_FACTOR,
      cpuSlowdownMultiplier: 4,
    },
    emulation: MOTOGPOWER_EMULATION_METRICS,

  },
  // Using a "broadband" connection type
  // Corresponds to "Dense 4G 25th percentile" in https://docs.google.com/document/d/1Ft1Bnq9-t4jK5egLSOc28IL4TvR-Tt0se_1faTA4KTY/edit#heading=h.bb7nfy2x9e5v
}

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] })

const pageTargets = targets.map(target =>
  pages.map(page => `${target}/${page}`),
)

await fs.mkdir('./reports', { recursive: true })


const progressBar = new cliProgress.MultiBar({
  clearOnComplete: false,
  hideCursor: true,
  format: '{bar} | {percentage}% | {value}/{total} | {eta}s',
}, cliProgress.Presets.shades_grey)

const bar = progressBar.create(pageTargets.flat().length * Object.keys(throttlingSettings).length, 0, {
  label: 'Overall progress',
})

for (const target of pageTargets) {
  const url = new URL(target[0]);
  const dir = `./reports/${apiDelay}ms/${url.hostname}-${url.port}`
  await fs.mkdir(dir, { recursive: true })


  for (const page of target) {
    const pageUrl = new URL(page)
    const pageDir = `${dir}/${pageUrl.pathname}`

    await fs.mkdir(pageDir, { recursive: true })
    
    for (const [throttlingName, throttlingSetting] of Object.entries(throttlingSettings)) {
      const results: Result[] = [];
      const throttlingDir = `${pageDir}/${throttlingName}`
      await fs.mkdir(throttlingDir, { recursive: true })


      const runBar = progressBar.create(runsPerPage, 0, {
        label: pageUrl.toString() + ":"
      })
      for (let i = 0; i < runsPerPage; i++) {
        runBar.increment()

        const runnerResult = await lighthouse(pageUrl.toString(), {
          port: chrome.port,
          output: 'json',
          onlyCategories: ['performance'],
          throttling: throttlingSetting.throttling,
          screenEmulation: throttlingSetting.emulation,
          formFactor: throttlingSetting.emulation.mobile ? 'mobile' : 'desktop',
          disableFullPageScreenshot: true,
        })

        if (!runnerResult || runnerResult.lhr.runtimeError ) {
          // Rerun the test if there was a runtime error
          i--;
          continue;
        }

        if (!runnerResult) {
          throw new Error('No runner result')
        }

        const report = runnerResult.report
        results.push(runnerResult.lhr)
        const reportPath = `${throttlingDir}/${i}.json`
        await fs.writeFile(reportPath, report)
      }

      const csvReportPath = `${throttlingDir}/report.csv`
      await fs.unlink(csvReportPath).catch(() => {});

      for (let i = 0; i < results.length; i++) {
        const { header, values } = resultToCsv(results[i]);
        const contents = i === 0 ? `${header}\n${values}\n` : `${values}\n`
        await fs.appendFile(csvReportPath, contents)
      }

      // const statistics = parseResults(results)
      // const statisticsPath = `${throttlingDir}/statistics.json`
      // await fs.writeFile(statisticsPath, JSON.stringify(statistics, null, 2))

      runBar.stop()
      bar.increment()
    }
  }
}

progressBar.stop()
chrome.kill()