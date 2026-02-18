/**
 * Tests for Workspace Detector
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { detectD365Project, autoDetectD365Project } from '../src/utils/workspaceDetector.js';

describe('WorkspaceDetector', () => {
  const testDir = path.join(process.cwd(), 'test-workspace');
  const projectDir = path.join(testDir, 'MySolution', 'MyProject');
  const projectFile = path.join(projectDir, 'MyProject.rnrproj');

  beforeEach(async () => {
    // Create test directory structure
    await fs.mkdir(projectDir, { recursive: true });
    
    // Create a sample .rnrproj file
    const projectContent = `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="14.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <Platform Condition=" '$(Platform)' == '' ">AnyCPU</Platform>
    <BuildTasksDirectory Condition=" '$(BuildTasksDirectory)' == ''">$(MSBuildProgramFiles32)\\MSBuild\\Microsoft\\Dynamics\\AX</BuildTasksDirectory>
    <Model>TestModel</Model>
    <TargetFrameworkVersion>v4.6</TargetFrameworkVersion>
    <OutputPath>bin</OutputPath>
    <SchemaVersion>2.0</SchemaVersion>
    <GenerateCrossReferences>True</GenerateCrossReferences>
    <ProjectGuid>{12345678-1234-1234-1234-123456789012}</ProjectGuid>
    <Name>MyProject</Name>
    <RootNamespace>MyProject</RootNamespace>
  </PropertyGroup>
</Project>`;
    
    await fs.writeFile(projectFile, projectContent, 'utf-8');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should detect D365FO project from workspace', async () => {
    const result = await detectD365Project(testDir);
    
    expect(result).not.toBeNull();
    expect(result?.modelName).toBe('TestModel');
    expect(result?.projectPath).toContain('MyProject.rnrproj');
    expect(result?.solutionPath).toContain('MySolution');
  });

  it('should return null when no .rnrproj files found', async () => {
    const emptyDir = path.join(testDir, 'Empty');
    await fs.mkdir(emptyDir, { recursive: true });
    
    const result = await detectD365Project(emptyDir);
    
    expect(result).toBeNull();
  });

  it('should handle nested project files', async () => {
    const nestedProject = path.join(testDir, 'Solution', 'Nested', 'Deep', 'Project.rnrproj');
    await fs.mkdir(path.dirname(nestedProject), { recursive: true });
    
    const projectContent = `<?xml version="1.0" encoding="utf-8"?>
<Project>
  <PropertyGroup>
    <Model>NestedModel</Model>
  </PropertyGroup>
</Project>`;
    
    await fs.writeFile(nestedProject, projectContent, 'utf-8');
    
    const result = await detectD365Project(testDir);
    
    expect(result).not.toBeNull();
    // Should find the first project (alphabetically or by discovery order)
    expect(result?.modelName).toMatch(/TestModel|NestedModel/);
  });

  it('should skip common directories during search', async () => {
    // Create a .rnrproj in node_modules (should be skipped)
    const nodeModulesProject = path.join(testDir, 'node_modules', 'package', 'Test.rnrproj');
    await fs.mkdir(path.dirname(nodeModulesProject), { recursive: true });
    await fs.writeFile(nodeModulesProject, '<Project><PropertyGroup><Model>NodeModule</Model></PropertyGroup></Project>', 'utf-8');
    
    const result = await detectD365Project(testDir);
    
    // Should find TestModel, not NodeModule
    expect(result?.modelName).toBe('TestModel');
  });

  it('should auto-detect from current working directory', async () => {
    // Note: This test depends on the actual process.cwd()
    // In a real scenario, you might want to mock process.cwd()
    const result = await autoDetectD365Project();
    
    // Result might be null if CWD doesn't contain .rnrproj
    // This test mainly ensures the function doesn't crash
    expect(result).toBeDefined();
  });
});
