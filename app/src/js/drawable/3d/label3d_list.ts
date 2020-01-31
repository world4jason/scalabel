import _ from 'lodash'
import * as THREE from 'three'
import { policyFromString } from '../../common/track/track'
import { LabelTypeName, ShapeTypeName, TrackPolicyType } from '../../common/types'
import { makeState } from '../../functional/states'
import { State } from '../../functional/types'
import { Box3D } from './box3d'
import { TransformationControl } from './control/transformation_control'
import { Cube3D } from './cube3d'
import { Grid3D } from './grid3d'
import { Label3D, labelTypeFromString } from './label3d'
import { Plane3D } from './plane3d'
import { Shape3D } from './shape3d'

/**
 * Make a new drawable shape based on type
 */
export function makeDrawableShape3D (
  shapeType: string
): Shape3D | null {
  switch (shapeType) {
    case ShapeTypeName.CUBE:
      return new Cube3D()
    case ShapeTypeName.GRID:
      return new Grid3D()
  }
  return null
}

/**
 * Make a new drawable label based on the label type
 * @param {string} labelType: type of the new label
 */
export function makeDrawableLabel3D (
  labelList: Label3DList,
  labelType: string
): Label3D | null {
  switch (labelType) {
    case LabelTypeName.BOX_3D:
      return new Box3D(labelList)
    case LabelTypeName.PLANE_3D:
      return new Plane3D(labelList)
  }
  return null
}

/**
 * List of drawable labels
 */
export class Label3DList {
  /** transformation control */
  public control: TransformationControl

  /** Scalabel id to labels */
  private _labels: {[labelId: number]: Label3D}
  /** shape id to shape drawable map */
  private _shapes: {[shapeId: number]: Shape3D}
  /** ThreeJS Object id to labels */
  private _raycastMap: {[id: number]: Label3D}
  /** Recorded state of last update */
  private _state: State
  /** Scene for rendering */
  private _scene: THREE.Scene
  /** selected label */
  private _selectedLabel: Label3D | null
  /** List of ThreeJS objects for raycasting */
  private _raycastableShapes: Readonly<Array<Readonly<THREE.Object3D>>>
  /** callbacks */
  private _callbacks: Array<() => void>
  /** Labels to be committed */
  private _updatedLabels: Set<Label3D>
  /** Shapes to be committed */
  private _updatedShapes: Set<Shape3D>
  /** next temporary shape id */
  private _temporaryShapeId: number
  /** selected item */
  private _selectedItemIndex: number

  constructor () {
    this.control = new TransformationControl()
    this.control.layers.enableAll()
    this._labels = {}
    this._shapes = {}
    this._raycastMap = {}
    this._selectedLabel = null
    this._scene = new THREE.Scene()
    this._scene.add(this.control)
    this._raycastableShapes = []
    this._state = makeState()
    this._callbacks = []
    this._updatedLabels = new Set()
    this._updatedShapes = new Set()
    this._temporaryShapeId = -1
    this._selectedItemIndex = -1
  }

  /**
   * Return scene object
   */
  public get scene (): THREE.Scene {
    return this._scene
  }

  /** Subscribe callback for drawable update */
  public subscribe (callback: () => void) {
    this._callbacks.push(callback)
  }

  /** Unsubscribe callback for drawable update */
  public unsubscribe (callback: () => void) {
    const index = this._callbacks.indexOf(callback)
    if (index >= 0) {
      this._callbacks.splice(index, 1)
    }
  }

  /** Get label by id */
  public getLabel (id: number): Label3D | null {
    if (id in this._labels) {
      return this._labels[id]
    }
    return null
  }

  /** Get shape by id */
  public getShape (id: number): Shape3D | null {
    if (id in this._shapes) {
      return this._shapes[id]
    }
    return null
  }

  /** Call when any drawable has been updated */
  public onDrawableUpdate (): void {
    for (const callback of this._callbacks) {
      callback()
    }
  }

  /**
   * Get selected label
   */
  public get selectedLabel (): Label3D | null {
    return this._selectedLabel
  }

  /**
   * Get id's of selected labels
   */
  public get selectedLabelIds (): {[index: number]: number[]} {
    return this._state.user.select.labels
  }

  /** Get all policy types in config */
  public get policyTypes (): TrackPolicyType[] {
    return this._state.task.config.policyTypes.map(policyFromString)
  }

  /** Get all label types in config */
  public get labelTypes (): LabelTypeName[] {
    return this._state.task.config.labelTypes.map(labelTypeFromString)
  }

  /**
   * Get current policy type
   */
  public get currentPolicyType (): TrackPolicyType {
    return policyFromString(
      this._state.task.config.policyTypes[this._state.user.select.policyType]
    )
  }

  /**
   * Get current label type
   */
  public get currentLabelType (): LabelTypeName {
    return labelTypeFromString(
      this._state.task.config.labelTypes[this._state.user.select.labelType]
    )
  }

  /**
   * Get index of current category
   */
  public get currentCategory (): number {
    return this._state.user.select.category
  }

  /**
   * update labels from the state
   */
  public updateState (state: State): void {
    this._state = state

    const newShapes: {[labelId: number]: Shape3D} = {}
    const newLabels: {[labelId: number]: Label3D} = {}
    const newRaycastableShapes: Array<Readonly<THREE.Object3D>> = [this.control]
    const newRaycastMap: {[id: number]: Label3D} = {}
    const item = state.task.items[state.user.select.item]

    if (this._selectedLabel) {
      this._selectedLabel.selected = false
    }
    this._selectedLabel = null

    // Reset control & scene
    for (const key of Object.keys(this._labels)) {
      const id = Number(key)
      if (!(id in item.labels)) {
        for (const shape of Object.values(this._labels[id].shapes())) {
          this._scene.remove(shape)
        }
      }
    }

    for (const key of Object.keys(item.indexedShapes)) {
      const shapeId = Number(key)
      const indexedShape = item.indexedShapes[shapeId]
      if (!(shapeId in this._shapes)) {
        const newShape = makeDrawableShape3D(indexedShape.type)
        if (newShape) {
          newShapes[shapeId] = newShape
        }
      }
      if (shapeId in this._shapes) {
        const drawableShape = this._shapes[shapeId]
        drawableShape.updateState(indexedShape)
        newShapes[shapeId] = drawableShape
      }
    }

    this._shapes = newShapes

    // Update & create labels
    for (const key of Object.keys(item.labels)) {
      const id = Number(key)
      if (id in this._labels) {
        newLabels[id] = this._labels[id]
      } else {
        const newLabel = makeDrawableLabel3D(this, item.labels[id].type)
        if (newLabel) {
          newLabels[id] = newLabel
        }
      }
      if (newLabels[id]) {
        newLabels[id].updateState(
          state, state.user.select.item, id
        )
        for (const shape of Object.values(newLabels[id].shapes())) {
          newRaycastableShapes.push(shape)
          newRaycastMap[shape.id] = newLabels[id]
          this._scene.add(shape)
        }

        newLabels[id].selected = false

        // Disable all layers. Viewers will re-enable
        // for (const shape of newLabels[id].shapes()) {
        //   shape.layers.disableAll()
        // }
      }
    }

    // Assign parents
    for (const key of Object.keys(newLabels)) {
      const id = Number(key)
      if (item.labels[id].parent in newLabels) {
        newLabels[item.labels[id].parent].addChild(newLabels[id])
      }
    }

    this._raycastableShapes = newRaycastableShapes
    this._labels = newLabels
    this._raycastMap = newRaycastMap

    this.control.clearLabels()
    const select = state.user.select
    if (select.item in select.labels) {
      const selectedLabelIds = select.labels[select.item]
      if (selectedLabelIds.length === 1 &&
          selectedLabelIds[0] in this._labels) {
        this._selectedLabel = this._labels[select.labels[select.item][0]]
        this._selectedLabel.selected = true
        this.control.addLabel(this._selectedLabel)
      }
    }

    this._selectedItemIndex = select.item

    if (this.selectedLabel) {
      this.control.visible = true
    } else {
      this.control.visible = false
    }
  }

  /**
   * Get raycastable list
   */
  public get raycastableShapes (): Readonly<Array<Readonly<THREE.Object3D>>> {
    return this._raycastableShapes
  }

  /**
   * Get the label associated with the raycasted object 3d
   * @param obj
   */
  public getLabelFromRaycastedObject3D (
    obj: THREE.Object3D
  ): Label3D | null {
    while (obj.parent && !(obj.id in this._raycastMap)) {
      obj = obj.parent
    }

    if (obj.id in this._raycastMap) {
      return this._raycastMap[obj.id]
    }
    return null
  }

  /** Set active camera */
  public setActiveCamera (camera: THREE.Camera) {
    for (const label of Object.values(this._labels)) {
      label.activeCamera = camera
    }
    this.onDrawableUpdate()
  }

  /** Get uncommitted labels */
  public get updatedLabels (): Readonly<Set<Readonly<Label3D>>> {
    return this._updatedLabels
  }

  /** Push updated label to array */
  public addUpdatedLabel (label: Label3D) {
    this._updatedLabels.add(label)
  }

  /** Get uncommitted labels */
  public get updatedShapes (): Readonly<Set<Readonly<Shape3D>>> {
    return this._updatedShapes
  }

  /** Add temporary shape */
  public addTemporaryShape (shape: Shape3D) {
    this._shapes[this._temporaryShapeId] = shape
    const indexedShape = shape.toState()
    indexedShape.id = this._temporaryShapeId
    indexedShape.item = this._selectedItemIndex
    shape.updateState(indexedShape)
    this._temporaryShapeId--
    this.addUpdatedShape(shape)
    return shape
  }

  /** Push updated label to array */
  public addUpdatedShape (label: Shape3D) {
    this._updatedShapes.add(label)
  }

  /** Clear uncommitted label list */
  public clearUpdated () {
    this._updatedLabels.clear()
    this._updatedShapes.clear()
    this._temporaryShapeId = -1
  }
}
