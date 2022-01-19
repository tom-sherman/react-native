/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @flow
 */

'use strict';

const Dimensions = require('../Utilities/Dimensions');
const InspectorOverlay = require('./InspectorOverlay');
const InspectorPanel = require('./InspectorPanel');
const Platform = require('../Utilities/Platform');
const PressabilityDebug = require('../Pressability/PressabilityDebug');
const React = require('react');
const ReactNative = require('../Renderer/shims/ReactNative');
const StyleSheet = require('../StyleSheet/StyleSheet');
const View = require('../Components/View/View');

const invariant = require('invariant');

import type {
  HostComponent,
  TouchedViewDataAtPoint,
} from '../Renderer/shims/ReactNativeTypes';

type HostRef = React.ElementRef<HostComponent<mixed>>;

export type ReactRenderer = {
  rendererConfig: {
    getInspectorDataForViewAtPoint: (
      inspectedView: ?HostRef,
      locationX: number,
      locationY: number,
      callback: Function,
    ) => void,
    ...
  },
};

const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
const renderers = findRenderers();

// Required for React DevTools to view/edit React Native styles in Flipper.
// Flipper doesn't inject these values when initializing DevTools.
hook.resolveRNStyle = require('../StyleSheet/flattenStyle');
const viewConfig = require('../Components/View/ReactNativeViewViewConfig');
hook.nativeStyleEditorValidAttributes = Object.keys(
  viewConfig.validAttributes.style,
);

function findRenderers(): $ReadOnlyArray<ReactRenderer> {
  const allRenderers = Array.from(hook.renderers.values());
  invariant(
    allRenderers.length >= 1,
    'Expected to find at least one React Native renderer on DevTools hook.',
  );
  return allRenderers;
}

function getInspectorDataForViewAtPoint(
  inspectedView: ?HostRef,
  locationX: number,
  locationY: number,
  callback: (viewData: TouchedViewDataAtPoint) => void,
) {
  // Check all renderers for inspector data.
  for (let i = 0; i < renderers.length; i++) {
    const renderer = renderers[i];
    if (renderer?.rendererConfig?.getInspectorDataForViewAtPoint != null) {
      renderer.rendererConfig.getInspectorDataForViewAtPoint(
        inspectedView,
        locationX,
        locationY,
        viewData => {
          // Only return with non-empty view data since only one renderer will have this view.
          if (viewData && viewData.hierarchy.length > 0) {
            callback(viewData);
          }
        },
      );
    }
  }
}

type InspectorProps = {
  inspectedView: ?HostRef,
  onRequestRerenderApp: (callback: (instance: ?HostRef) => void) => void,
  ...
};

type InspectorState = {
  devtoolsAgent: ?Object,
  hierarchy: any,
  panelPos: string,
  inspecting: boolean,
  selection: ?number,
  perfing: boolean,
  inspected: any,
  inspectedView: ?HostRef,
  networking: boolean,
};

function Inspector({
  inspectedView,
  onRequestRerenderApp,
}: InspectorProps): React$Element<any> {
  const [state, setState] = React.useState<InspectorState>({
    devtoolsAgent: null,
    hierarchy: null,
    panelPos: 'bottom',
    inspecting: true,
    perfing: false,
    inspected: null,
    selection: null,
    inspectedView: inspectedView,
    networking: false,
  });
  const setTouchedViewDataRef =
    React.useRef<?(TouchedViewDataAtPoint) => void>(null);
  const hideTimeoutIdRef = React.useRef<?TimeoutID>(null);

  React.useEffect(() => {
    function onAgentHideNativeHighlight() {
      if (state.inspected === null) {
        return;
      }

      // we wait to actually hide in order to avoid flicker
      hideTimeoutIdRef.current = setTimeout(() => {
        setState(oldState => ({...oldState, inspected: null}));
      }, 100);
    }

    function onAgentShowNativeHighlight(node: any) {
      clearTimeout(hideTimeoutIdRef.current);

      // Shape of `node` is different in Fabric.
      const component = node.canonical ?? node;

      component.measure((x, y, width, height, left, top) => {
        setState(oldState => ({
          ...oldState,
          hierarchy: [],
          inspected: {
            frame: {left, top, width, height},
          },
        }));
      });
    }

    function onAgentShutdown() {
      const agent = state.devtoolsAgent;
      if (agent != null) {
        agent.removeListener('hideNativeHighlight', onAgentHideNativeHighlight);
        agent.removeListener('showNativeHighlight', onAgentShowNativeHighlight);
        agent.removeListener('shutdown', onAgentShutdown);

        setState(oldState => ({...oldState, devtoolsAgent: null}));
      }
    }

    function attachToDevtools(agent: Object) {
      agent.addListener('hideNativeHighlight', onAgentHideNativeHighlight);
      agent.addListener('showNativeHighlight', onAgentShowNativeHighlight);
      agent.addListener('shutdown', onAgentShutdown);

      setState(oldState => ({
        ...oldState,
        devtoolsAgent: agent,
      }));
    }

    hook.on('react-devtools', attachToDevtools);

    return () => {
      hook.off('react-devtools', attachToDevtools);
      onAgentShutdown();
      setTouchedViewDataRef.current = null;
    };
  }, [state.inspected, state.devtoolsAgent]);

  React.useEffect(() => {
    setState(oldState => ({
      ...oldState,
      inspectedView,
    }));
  }, [inspectedView]);

  function onTouchPoint(locationX, locationY) {
    setTouchedViewDataRef.current = viewData => {
      const {
        hierarchy,
        props,
        selectedIndex,
        source,
        frame,
        pointerY,
        touchedViewTag,
      } = viewData;

      // Sync the touched view with React DevTools.
      // Note: This is Paper only. To support Fabric,
      // DevTools needs to be updated to not rely on view tags.
      if (state.devtoolsAgent && touchedViewTag) {
        state.devtoolsAgent.selectNode(
          ReactNative.findNodeHandle(touchedViewTag),
        );
      }

      setState(oldState => ({
        ...oldState,
        panelPos:
          pointerY > Dimensions.get('window').height / 2 ? 'top' : 'bottom',
        selection: selectedIndex,
        hierarchy,
        inspected: {
          style: props.style,
          frame,
          source,
        },
      }));
    };
    getInspectorDataForViewAtPoint(
      state.inspectedView,
      locationX,
      locationY,
      viewData => {
        if (this._setTouchedViewData != null) {
          this._setTouchedViewData(viewData);
          this._setTouchedViewData = null;
        }
      },
    );
  }

  function setPerfing(val) {
    setState(oldState => ({
      ...oldState,
      perfing: val,
      inspecting: false,
      inspected: null,
      networking: false,
    }));
  }

  function setInspecting(val) {
    setState(oldState => ({
      ...oldState,
      inspecting: val,
      inspected: null,
    }));
  }

  function setSelection(i) {
    const hierarchyItem = state.hierarchy[i];
    // we pass in ReactNative.findNodeHandle as the method is injected
    const {measure, props, source} = hierarchyItem.getInspectorData(
      ReactNative.findNodeHandle,
    );

    measure((x, y, width, height, left, top) => {
      setState(oldState => ({
        ...oldState,
        inspected: {
          frame: {left, top, width, height},
          style: props.style,
          source,
        },
        selection: i,
      }));
    });
  }

  function setTouchTargeting(val) {
    PressabilityDebug.setEnabled(val);
    onRequestRerenderApp(newInspectedView => {
      setState(oldState => ({...oldState, inspectedView: newInspectedView}));
    });
  }

  function setNetworking(val) {
    setState(oldState => ({
      ...oldState,
      networking: val,
      perfing: false,
      inspecting: false,
      inspected: null,
    }));
  }

  const panelContainerStyle =
    state.panelPos === 'bottom'
      ? {bottom: 0}
      : {top: Platform.OS === 'ios' ? 20 : 0};

  return (
    <View style={styles.container} pointerEvents="box-none">
      {state.inspecting && (
        <InspectorOverlay
          inspected={state.inspected}
          onTouchPoint={onTouchPoint.bind(this)}
        />
      )}
      <View style={[styles.panelContainer, panelContainerStyle]}>
        <InspectorPanel
          devtoolsIsOpen={!!state.devtoolsAgent}
          inspecting={state.inspecting}
          perfing={state.perfing}
          setPerfing={setPerfing}
          setInspecting={setInspecting}
          inspected={state.inspected}
          hierarchy={state.hierarchy}
          selection={state.selection}
          setSelection={setSelection}
          touchTargeting={PressabilityDebug.isEnabled()}
          setTouchTargeting={setTouchTargeting}
          networking={state.networking}
          setNetworking={setNetworking}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'transparent',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  panelContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
});

module.exports = Inspector;
