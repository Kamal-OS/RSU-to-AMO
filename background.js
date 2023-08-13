// TODO: use doc UUID (docId) to prevent reinjection when laod inplace or load from cache
let COMPLETE_ONCE = false

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const RSU_URL = "https://www.rsu.ma/rsu/personnal-space"
    const RSU_DEMO = "/demo/demo.html"
    const RNP_URL = "https://www.rnp.ma/pre-registration-ui/#/"

    if (tab.url.startsWith(RSU_URL) || tab.url.endsWith(RSU_DEMO)) {
        /*
        * RSU_URL when opened has multiple 'complete' status
        * so inject once we need the following if code
        */
        if (COMPLETE_ONCE && tab.status === "loading") {
            COMPLETE_ONCE = false
        }
        else if (!COMPLETE_ONCE && tab.status === "complete") {
            COMPLETE_ONCE = true

            chrome.scripting.insertCSS({
                target: { tabId: tab.id },
                files: ["./style/rsu-ui.css"]
            })

            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["./scripts/inject/rsu-ui.js"]
            })
        }
    }

    // Prevent RNP inactive state detection (Auto-click)
    else if (tab.url.startsWith(RNP_URL)) {
        if (tab.status === "complete") {
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const div = document.querySelector("div.heading")
                    setInterval(() => {
                        div.click()
                        console.log("Clicked!")
                    }, 1000)
                },
                world: "MAIN"
            })
        }
    }
})

const AMO_URL = "https://www.amotadamon.ma/"

var data = {
    families: null,
    window: null,
    groupId: null
}
Object.seal(data) // static object: can't add or remove properties

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === "rsu-ui-ready") {
        await chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            files: ["./scripts/inject/rsu-data.js"]
        })
    }

    if (message.type === "rsu-data-ready") {
        data.families = message.data

        // create new window
        data.window = await chrome.windows.create({
            focused: true
        })

        // inject head of family
        injectData(data.families.head, true)
        delete data.families.head
    }

    // TODO: this lisetener may get things confused next time you go to the url
    // There is better ways
    // double listerners, listerner on top of another?
    // move to top?
    if (message.type === "amo-form-done") {
        chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            const AMO_COMPLETE_URL = AMO_URL + "Demande_Reussie_Ar.aspx"

            if (tab.id === sender.tab.id && tab.url.startsWith(AMO_COMPLETE_URL) && tab.status === "complete") {
                // click the download button
                // await chrome.scripting.executeScript({
                //     target: { tabId: sender.tab.id },
                //     func: () => {
                //         document.querySelector("#ctl00_ContentPlaceHolder1_Imprimer").click()
                //     },
                //     world: "MAIN"
                // })
                
                if (!data.families) return
                
                for (const [key, value] of Object.entries(data.families)) {
                    if (!value || ((key === "adults" || key === "siblings") && value.length < 1)) {
                        delete data.families[key]
                        console.log(`${key} deleted`)
                        continue
                    }

                    if (key === "adults" || key === "siblings") { // array
                        injectData(data.families[key].shift())
                        console.log(`${key} injected`)
                    }
                    else { // single
                        injectData(data.families[key])
                        console.log(`${key} injected`)
                        delete data.families[key]
                        console.log(`${key} deleted`)
                    }
                    break
                }

            }
        })
    }

    if (message.type === "click-add-child") {
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            func: () => {
                document.querySelector('[id*="ButtonAdd"]').click()
            },
            world: "MAIN"
        })
    }
})

async function injectData(family, isFirst = false) {
    // null
    if (!family) return

    // create tab with AMO_URL
    const amoTab = await chrome.tabs.create({
        active: isFirst,
        url: AMO_URL,
        windowId: data.window.id
    })

    if (isFirst) {
        // create a tab group
        data.groupId = await chrome.tabs.group({
            tabIds: amoTab.id,
            createProperties: {
                windowId: data.window.id
            }
        })

        chrome.tabGroups.update(data.groupId, {
            title: "AMO",
            color: "blue"
        })

        // remove first empty tab
        chrome.tabs.remove(data.window.tabs[0].id)
    }

    if (!isFirst) {
        // add tab to the group
        chrome.tabs.group({
            tabIds: amoTab.id,
            groupId: data.groupId
        })
    }
    
    // Enter to form filling page
    await chrome.scripting.executeScript({
        target: { tabId: amoTab.id },
        func: () => {
            document.querySelector("a.intro-btn-bl").click()
        }
    })

    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
        if (tab.id === amoTab.id && tab.url.startsWith(AMO_URL + "Formulaire_Inscription_Ar.aspx") && tab.status === "complete") {
            chrome.tabs.sendMessage(amoTab.id,
                {
                    type: "amo-form-insert",
                    data: family
                }
            )
        }
    })
}
