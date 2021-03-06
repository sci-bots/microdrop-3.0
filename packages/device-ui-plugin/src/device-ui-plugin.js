require('style-loader!css-loader!jquery-contextmenu/dist/jquery.contextMenu.css');
const $ = require('jquery'); require('jquery-contextmenu');
const Key = require('keyboard-shortcut');
const Dat = require('dat.gui/build/dat.gui');
const uuid = require('uuid/v4');
const yo = require('yo-yo');

const DeviceController = require('@microdrop/device-controller/src/device-controller');
const MicropedeAsync = require('@micropede/client/src/async.js');
const {MicropedeClient, DumpStack} = require('@micropede/client/src/client.js')
const UIPlugin = require('@microdrop/ui-plugin');

const {
  ParseSVGFromString,
  ConstructObjectsFromSVG
} = require('@microdrop/device-controller/src/svg-renderer');

const DIRECTIONS = {LEFT: "left", UP: "up", DOWN: "down", RIGHT: "right"};
window.MicropedeAsync = MicropedeAsync;
window.MicropedeClient = MicropedeClient;

class DeviceUIPlugin extends UIPlugin {
  constructor(elem, focusTracker, port, ...args) {
    super(elem, focusTracker, port, ...args);
    this.controls = null;
    this.contextMenu = null;
    this.gui = null;
    this.element.style.padding = "0px";
  }

  listen() {
    this.on("updateRequest", this.onUpdateRequest.bind(this));
    this.onStateMsg('device-model', 'three-object', this.renderDevice.bind(this));

    let loaded = false;
    this.onStateMsg('web-server', 'first-load', async (firstLoad) => {
      if (firstLoad == true && loaded == false) {
        loaded = true;
        const microdrop = new MicropedeAsync('microdrop', undefined, this.port);
        await microdrop.triggerPlugin('device-model', 'load-default');
      }
    });

    this.onTriggerMsg('load-device', this.loadDevice.bind(this));

    this.bindPutMsg('device-model', 'three-object', 'put-device');

    // XXX: Sometimes updateRequest doesn't fire on page reload (thus force it with timeout)
    setTimeout(()=>this.trigger("updateRequest"), 1000);

    Key("left", this.move.bind(this, DIRECTIONS.LEFT));
    Key("right", this.move.bind(this, DIRECTIONS.RIGHT));
    Key("up", this.move.bind(this, DIRECTIONS.UP));
    Key("down", this.move.bind(this, DIRECTIONS.DOWN));

    this.element.focus();
    this.contextMenu = CreateContextMenu(this.element, this.contextMenuClicked.bind(this));
    this.element.onclick = () => this.element.focus();
  }

  move(...args) {
    if (!this.controls) return;
    if (document.activeElement != this.element) return;
    this.controls.electrodeControls.move(...args);
  }

  onUpdateRequest(msg) {
    if (!this.controls) {
      if (this._url) this.renderDevice(this._url);
      return;
    } else{
      this.controls.cameraControls.trigger("updateRequest", this);
    }
  }

  async renderDevice(payload) {
    this._url = payload;
    if (this.sceneContainer) {
      this.sceneContainer.innerHTML = '';
    } else  {
      this.sceneContainer = yo`
        <div style="width:100%;height:100%;overflow:hidden;"></div>`;
      this.element.appendChild(this.sceneContainer);
    }

    const bbox = this.element.getBoundingClientRect();
    if (bbox.width == 0) return;

    this.controls = await DeviceController.createScene(
      this.sceneContainer, this._url, this.port);

    // Listen to right click event for electrodeControls (in order to
    // be able to select it from the context menu)
    this.listenTo(this.controls.electrodeControls, 'right-click', (e) => {
      this._lastElectrodeRightClick = e;
    });

    this.gui = await CreateDatGUI(this.element, this.controls);
  }

  loadDevice(payload) {
    const LABEL = 'device-ui-plugin:loadDevice';
    try {
      let content = payload.content;
      const svg = ParseSVGFromString(content);
      const objects = ConstructObjectsFromSVG(svg);
      this.trigger('put-device', {'three-object': objects, ppi: objects.ppi});
      return this.notifySender(payload, 'success', "load-device");
    } catch (e) {
      return this.notifySender(payload, DumpStack(LABEL, e), "load-device", "failed");
    }
  }

  changeDevice() {
    const handler = (e) => {
      const f = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        this.loadDevice({content});
      };
      reader.readAsText(f);
    }

    const fileinput = yo`<input type='file' onchange=${handler.bind(this)} />`;
    fileinput.click();
  }

  contextMenuClicked(key, options) {
    const microdrop = new MicropedeAsync('microdrop', undefined, this.port);
    switch (key) {
      case "changeDevice":
        this.changeDevice();
        break;
      case "clearElectrodes":
        microdrop.putPlugin('electrodes-model', 'active-electrodes', []);
        break;
      case "clearRoutes":
        microdrop.putPlugin('routes-model', 'routes', []);
        break;
      case "clearRoute":
        if (!this.controls) return true;
        this.controls.routeControls.trigger("clear-route", {key, options});
        break;
      case "executeRoute":
        if (!this.controls) return true;
        this.controls.routeControls.trigger("execute-route", {key, options});
        break;
      case "executeRoutes":
        if (!this.controls) return true;
        microdrop.getState('routes-model', 'routes').then((routes) => {
          microdrop.triggerPlugin('routes-model', 'execute', {routes}, -1);
        });
        break;
      case "selectElectrode":
        const id = _.get(this._lastElectrodeRightClick, 'target.name');
        this.controls.electrodeControls.selectElectrode(id, false);
        break;
      case "selectRoute":
      if (!this.controls) return true;
        this.controls.routeControls.trigger("select-route", {key, options});
    }
    return true;
  }

  static CreateContextMenu(element, callback) {
    const id = uuid();
    element.setAttribute("id", id);

    const menu = $.contextMenu({
        selector: `#${id}`,
        callback: callback,
        trigger: 'none',
        items: {
            clearElectrodes: {name: "Clear Electrodes"},
            "sep1": "---------",
            clearRoute: {name: "Clear Route"},
            executeRoute: {name: "Execute Route"},
            "sep2": "---------",
            clearRoutes: {name: "Clear All Routes"},
            executeRoutes: {name: "Execute All Routes"},
            "sep3": "---------",
            changeDevice: {name: "Change Device"},
            "sep4": "----------",
            "selectElectrode": {name: "Select Electrode (Shift-Click)"},
            "selectRoute": {name: "Select Route (Alt-Click)"}
        }
    });

    const selector = $(`#${id}`);

    // Create a custom "drag threshold" event for context menu
    element.onmousedown = async (e) => {
      if (e.button == 2) {
        const x1 = e.clientX;
        const y1 = e.clientY;
        e = await new Promise((resolve, reject) => {
          element.onmouseup = (e) => {resolve(e)}
        });

        const x2 = e.clientX;
        const y2 = e.clientY;

        const dx = x2-x1;
        const dy = y2-y1;

        let shouldFire = false;

        const c = Math.sqrt(dx*dx + dy*dy);

        if (isNaN(c)) { selector.contextMenu(); }
        if (c <= 10)  { selector.contextMenu({x: x2, y: y2}); }
      }
    }
  }

  static async CreateDatGUI(container=null, menu={}) {
    let mediaDevices = await navigator.mediaDevices.enumerateDevices();
    mediaDevices = _.filter(mediaDevices, {kind: 'videoinput'});
    const keys = _.map(mediaDevices, (v, i) => {return i + ' ' + v.label });
    const cameraOptions = _.zipObject(keys, _.map(mediaDevices, 'deviceId'));
    const gui = new Dat.GUI({autoPlace: false, closed: true});
    let anchorState;

    const getVideoFeeds = async () => {
      let mediaDevices = await navigator.mediaDevices.enumerateDevices();
      return _.map(_.filter(mediaDevices, {kind: 'videoinput'}), "deviceId");
    }

    // Device handling object for Dat.GUI
    let stream;
    let devices = {
      _camera: -1,
      get camera() {return this._camera;},
      set camera(_camera) {
        const plane = menu.videoControls.plane;
        window.URL = (window.URL || window.webkitURL || window.mozURL ||
                      window.msURL);

        if (_camera == -2) {
          // Remove video feed if _camera == -2
          this._camera = _camera;
          localStorage.setItem("microdrop:last-webcam", -2);
          _.each(mediaDevices, (info) => {
            var constraints = {
              video: {deviceId: {exact: info.deviceId}}
            };
            navigator.mediaDevices.getUserMedia(constraints)
              .then(function(_stream) {
                stream = stream || _stream;
                stream.getTracks().forEach(track => {
                  track.stop();
                });
                _stream.getTracks().forEach(track => {
                  track.stop();
                });
                plane.stream.getTracks().forEach(track => {
                  track.stop();
                });
            });
          });
          return;
        }

        navigator.mediaDevices.enumerateDevices().then((mediaDevices) => {
          mediaDevices = _.filter(mediaDevices, {kind: 'videoinput'});

          const info = _.filter(mediaDevices, {deviceId: _camera})[0];
          var constraints = {
            video: {deviceId: info.deviceId ? {exact: info.deviceId} : undefined}
          };
          navigator.mediaDevices.getUserMedia(constraints)
          .then(function(_stream) {
            if (stream)
            stream.getTracks().forEach(t => t.stop() );
            stream = _stream;
            localStorage.setItem("microdrop:last-webcam", info.deviceId);
            plane.video.src = URL.createObjectURL(stream);
            // if (!plane.videoTexture) plane.initVideo();
          });
          this._camera = _camera;
        });
      },
      resetAnchors() {
        menu.videoControls.reset();
        anchorState.setValue(false);
      },
      flipHorizontal() {
        menu.videoControls.flipHorizontal();
      },
      flipVertical() {
        menu.videoControls.flipVertical();
      },
      get offOpacity() {
        return this._offOpacity || _.get(menu, 'electrodeControls.offOpacity');
      },
      set offOpacity(_offOpacity) {
        this._offOpacity = _offOpacity;
        menu.electrodeControls.setOffOpacity(_offOpacity);
      },
      get onOpacity() {
        return this._onOpacity || _.get(menu, 'electrodeControls.onOpacity');
      },
      set onOpacity(_onOpacity) {
        this._onOpacity = _onOpacity;
        menu.electrodeControls.setOnOpacity(_onOpacity);
      }
    };

    const defaultCameraOptions = {
      'Choose Camera': -1,
      'No Camera': -2
    };

    // Setup Dat.GUI
    if (!container) container = document.body;
    anchorState = gui.add(menu.videoControls, "displayAnchors");
    gui.add(menu.electrodeControls, "showChannels");
    gui.add(devices, 'camera',  _.extend(defaultCameraOptions, cameraOptions));
    gui.add(devices, 'resetAnchors');
    gui.add(devices, 'flipHorizontal');
    gui.add(devices, 'flipVertical');
    gui.add(devices, 'offOpacity', 0, 1);
    gui.add(devices, 'onOpacity', 0, 1);
    gui.closed = true;
    // Get list of video feeds, and restore if present
    const allFeeds = await getVideoFeeds();
    const lastFeed = localStorage.getItem('microdrop:last-webcam');
    if (_.indexOf([...allFeeds,...["-2"]], lastFeed) != -1 ) {
      devices.camera = lastFeed;
    }

    gui.domElement.style.position = "absolute";
    gui.domElement.style.top = "0px";
    gui.domElement.style.right = "0px";
    container.appendChild(gui.domElement);

    // Fix dat.gui ui (as select menus are broken for some reason)
    gui.domElement.style.overflow = 'visible';
    gui.domElement.onclick = (e) => {e.stopPropagation()};

    anchorState.onChange((state) => {
      if (state == true)  menu.electrodeControls.enabled = false;
      if (state == false) menu.electrodeControls.enabled = true;
    });

    return gui;
  }
}

const CreateContextMenu = DeviceUIPlugin.CreateContextMenu;
const CreateDatGUI = DeviceUIPlugin.CreateDatGUI;

module.exports = DeviceUIPlugin;
