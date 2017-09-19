// If microdropPlugins is not defined, alert the user to add a web plugin
// via the plugin-manager webpage:
if (!window.microdropPlugins) {
  alert(`
    No UI/Web Plugins found!
    Add them at "http://localhost:PORT/plugin-manager"
  `);
}

// Disable alert messages in datatables:
$.fn.dataTable.ext.errMode = 'throw';

let focusTracker;

function createDock(title) {
    var widget = new PhosphorWidgets.Panel();
    widget.title.className = "dock hidden";
    return widget;
}

function setSizes(dockPanel, sizes) {
  function rec(splitLayout, [me, ...children]) {
    let childLayoutList = splitLayout.children.filter(
      (child) => child instanceof splitLayout.constructor
    );

    let childNum = 0;
    let num = 0;

    for(let child of children) {
      if(typeof(child) != 'number') {
        rec(childLayoutList[childNum++], child);
        child = child[0];
      }
      splitLayout.sizers[num++].sizeHint = child;
    }

    splitLayout.normalized = true;
  }

  rec(dockPanel.layout._root, sizes);
  dockPanel.update();
}

window.panel = new PhosphorWidgets.DockPanel();
window.widgetMap = new Map();
window.hasLaunched = false;

panel.spacing = 10;
dock = createDock("top-left");

panel.id = 'main';
panel.addWidget(dock);

PhosphorWidget.attach(panel, document.body);

focusTracker = new FocusTracker();
for (const [pluginName,pluginClass] of microdropPlugins) {
  // const dock = docks[pluginClass.position()];
  const widget = pluginClass.Widget(panel, dock, focusTracker);
  widgetMap.set(widget.title.label, widget);
}
dock.dispose();

function restorePanels() {
  // Use first widget as anchor for latter added widgets
  let firstWidget = null;

  function getChildren(obj) {
    // Traverse the layout structure, replacing widgetNames with widgetObjects
    const children = obj.children;
    if ("widgets" in obj) {
      const widgetObjects = new Array();
      for (const title of obj.widgets){
        // Replace each widgetName with widgetObject
        let widget = widgetMap.get(title);
        if (!firstWidget) firstWidget = widget;
        widgetObjects.push(widget);
        // Delete from widgetMap, to keep track of new
        // widgets not saved in layout
        widgetMap.delete(title);
      }
      obj.widgets = widgetObjects;
    }
    // Continue traversal
    if (children == undefined) return;
    for (const child of children) {
      getChildren(child);
    }
  }

  // Fetch the layout, and replace widgetNames with widgetObjects
  const layout = JSON.parse(localStorage.getItem("microdrop:layout"));
  getChildren(layout.main);
  panel.restoreLayout(layout);

  // For any widgets, not mentioned in they layout, add them to the first
  // widget
  for (const [title, widget] of widgetMap) {
    panel.addWidget(widget,  {mode: "tab-after", ref: firstWidget});
  }
  return layout;
}

function savePanels() {
  // Save layout to local storage
  function getChildren(obj) {
    // Traverse layout, replacing widgetObject with widgetName to make
    // the layout JSON serializable
    const children = obj.children;
    if ("widgets" in obj) {
      const widgetNames = new Array();
      for (const widget of obj.widgets)
        widgetNames.push(widget.title.label);
      obj.widgets = widgetNames;
    }
    if (children == undefined) return;
    for (const child of children) {
      getChildren(child);
    }
  }
  // Fetch layout, serialize it, and then save to local storage
  const layout = panel.saveLayout();
  getChildren(layout.main);
  localStorage.setItem("microdrop:layout", JSON.stringify(layout));
  return layout;
}

panel.onUpdateRequest = (msg) => {
  // Save layout everytime it is updated
  if (window.hasLaunched)
    savePanels();
  else {
    window.hasLaunched = true;
    if ("microdrop:layout" in window.localStorage)
      restorePanels()
    else
      savePanels();
  }
}

window.onresize = () => {panel.update()};
